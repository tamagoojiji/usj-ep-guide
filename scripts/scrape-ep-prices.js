/**
 * USJ EP価格ページ DOM抽出 → 価格マスター更新
 *
 * 使い方:
 *   node scrape-ep-prices.js
 *
 * 環境変数:
 *   GAS_WEB_APP_URL - GASデプロイメントURL
 *   GAS_API_KEY     - PRICE_UPDATE_API_KEY と同じ値
 *
 * 各パスの価格ページを開き、gds-calendar-dayのDOMから直接データを抽出
 * → 販売中の日付のみGASへ送信 → 価格マスター更新
 * → 売り切れの日付は価格マスターから削除
 */

const puppeteer = require("puppeteer");

// === 設定 ===

let PASS_PAGES = []; // fetchPassPages() で初期化

const WAIT_BETWEEN_PAGES_MS = 5000;
const PAGE_LOAD_TIMEOUT_MS = 60000;
const QUEUE_IT_TIMEOUT_MS = 120000;

// === メイン処理 ===

/**
 * GAS APIからURL一覧を取得
 */
async function fetchPassPages(gasUrl) {
  const apiUrl = gasUrl + "?action=getScrapingUrls";
  console.log("GAS APIからURL一覧を取得...");

  const response = await fetch(apiUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`URL一覧取得エラー: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(`URL一覧取得エラー: ${data.error}`);
  }

  console.log(`URL一覧取得完了: ${data.active}件 / 全${data.total}件`);
  return data.urls; // [{passId, label, url}, ...]
}

/**
 * URLに ?config=true がなければ自動付与
 */
function ensureConfigParam(url) {
  if (!url.includes("config=true")) {
    const separator = url.includes("?") ? "&" : "?";
    return url + separator + "config=true";
  }
  return url;
}

async function main() {
  const GAS_URL = process.env.GAS_WEB_APP_URL;
  const API_KEY = process.env.GAS_API_KEY;

  if (!GAS_URL || !API_KEY) {
    console.error("環境変数 GAS_WEB_APP_URL / GAS_API_KEY が未設定です");
    process.exit(1);
  }

  // URL一覧をGASから取得
  PASS_PAGES = await fetchPassPages(GAS_URL);

  if (PASS_PAGES.length === 0) {
    console.log("対象のURLがありません。スプレッドシートにURLを登録してください。");
    process.exit(0);
  }

  console.log(`\n対象: ${PASS_PAGES.length}パス`);
  PASS_PAGES.forEach((p, i) => console.log(`  ${i + 1}. ${p.label} (${p.passId})`));

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1280,1024",
    ],
  });

  const results = [];

  for (const pass of PASS_PAGES) {
    console.log(`\n--- ${pass.label} (${pass.passId}) ---`);

    try {
      const url = ensureConfigParam(pass.url);
      const domData = await openPageAndExtractDOM(browser, url);

      if (!domData) {
        console.log(`スキップ (${pass.passId}): カレンダーが表示されませんでした`);
        results.push({ passId: pass.passId, success: true, skipped: true });
        continue;
      }

      console.log(`DOM抽出: 販売中=${domData.available.length} 売切=${domData.soldOut.length}`);

      // 販売中の日付があれば価格更新
      if (domData.available.length > 0) {
        const updateResult = await postPricesDirectly(GAS_URL, API_KEY, pass.passId, domData.available);
        console.log(`価格更新: ${JSON.stringify(updateResult)}`);
      }

      // 売り切れの日付のステータスを「売切」に更新
      if (domData.soldOut.length > 0) {
        const markResult = await postMarkDatesAsSoldOut(GAS_URL, API_KEY, pass.passId, domData.soldOut);
        console.log(`売切マーク: ${JSON.stringify(markResult)}`);
      }

      if (domData.available.length === 0) {
        console.log(`完全売切: ${pass.passId}（全${domData.soldOut.length}日）`);
        results.push({ passId: pass.passId, success: true, soldOut: true });
      } else {
        results.push({ passId: pass.passId, success: true, available: domData.available.length });
      }
    } catch (err) {
      console.error(`エラー (${pass.passId}): ${err.message}`);
      results.push({ passId: pass.passId, success: false, error: err.message });
    }

    // パス間にウェイト
    if (PASS_PAGES.indexOf(pass) < PASS_PAGES.length - 1) {
      console.log(`${WAIT_BETWEEN_PAGES_MS / 1000}秒待機...`);
      await sleep(WAIT_BETWEEN_PAGES_MS);
    }
  }

  await browser.close();

  // 結果サマリー
  console.log("\n=== 結果サマリー ===");
  const succeeded = results.filter((r) => r.success && !r.skipped && !r.soldOut).length;
  const soldOut = results.filter((r) => r.soldOut).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`成功: ${succeeded} / 完全売切: ${soldOut} / スキップ: ${skipped} / 失敗: ${failed} / 合計: ${results.length}`);

  if (soldOut > 0) {
    console.log("\n完全売切のパス:");
    results
      .filter((r) => r.soldOut)
      .forEach((r) => console.log(`  - ${r.passId}`));
  }

  if (skipped > 0) {
    console.log("\nスキップしたパス:");
    results
      .filter((r) => r.skipped)
      .forEach((r) => console.log(`  - ${r.passId}`));
  }

  if (failed > 0) {
    console.log("\n失敗したパス:");
    results
      .filter((r) => !r.success)
      .forEach((r) => console.log(`  - ${r.passId}: ${r.error}`));
    process.exit(1);
  }
}

// === ページ操作・DOM抽出 ===

/**
 * ページを開いてカレンダーDOMから日付・価格・利用可否を直接抽出
 * @return {Object|null} { available: [{date, price}], soldOut: [date] } またはnull
 */
async function openPageAndExtractDOM(browser, url) {
  const page = await browser.newPage();

  try {
    // headless検知回避
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    });
    await page.setViewport({ width: 1280, height: 1024 });

    // ページ遷移
    console.log(`ページ遷移: ${url}`);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });

    // Queue-it リダイレクト検知
    const currentUrl = page.url();
    console.log(`現在のURL: ${currentUrl}`);
    if (currentUrl.includes("queue-it") || currentUrl.includes("queue.it")) {
      console.log("Queue-it 検出 — 待機中...");
      await handleQueueIt(page);
    }

    // HTTPステータスチェック
    if (response && response.status() >= 400) {
      throw new Error(`HTTPエラー: ${response.status()}`);
    }

    // SPAの完全描画を待つ
    try {
      await page.waitForNetworkIdle({ idleTime: 2000, timeout: 20000 });
    } catch {
      // タイムアウトしても続行
    }

    // 枚数セレクタ操作を試行（カレンダー表示のトリガーになる場合がある）
    const quantityClicked = await tryClickQuantitySelector(page);
    if (quantityClicked) {
      console.log("枚数セレクタをクリック");
      await sleep(3000);
    }

    // カレンダー要素の表示を待つ
    try {
      await page.waitForSelector("gds-calendar-day", { timeout: 30000 });
      console.log("カレンダー要素を検出");
    } catch {
      console.log("カレンダー要素が見つかりません — スキップ");
      return null;
    }

    // 描画完了を待つ
    await sleep(3000);

    // DOM直接抽出（初回: 当月+翌月）
    const domData = await extractCalendarFromDOM(page);
    console.log(`初回抽出: 販売中=${domData.available.length} 売切=${domData.soldOut.length}`);

    // 右矢印クリックで次の月へ遷移し、追加データを取得（最大2回）
    const MAX_FORWARD_CLICKS = 2;
    for (let i = 0; i < MAX_FORWARD_CLICKS; i++) {
      const clicked = await clickNextMonth(page);
      if (!clicked) {
        console.log(`右矢印クリック${i + 1}回目: 遷移失敗 — 終了`);
        break;
      }
      console.log(`右矢印クリック${i + 1}回目: 成功（DOM遷移確認済み）`);
      await sleep(2000); // 価格要素のレンダリング完了待ち

      const extraData = await extractCalendarFromDOM(page);
      console.log(`追加抽出${i + 1}: 販売中=${extraData.available.length} 売切=${extraData.soldOut.length}`);

      // 既存の日付と重複しないようマージ
      const existingDates = new Set(domData.available.map(d => d.date).concat(domData.soldOut));
      for (const item of extraData.available) {
        if (!existingDates.has(item.date)) {
          domData.available.push(item);
          existingDates.add(item.date);
        }
      }
      for (const date of extraData.soldOut) {
        if (!existingDates.has(date)) {
          domData.soldOut.push(date);
          existingDates.add(date);
        }
      }
    }

    return domData;
  } finally {
    await page.close();
  }
}

/**
 * gds-calendar-day要素から日付・価格・利用可否を直接抽出
 * @return {Object} { available: [{date, price}], soldOut: [date] }
 */
async function extractCalendarFromDOM(page) {
  return await page.evaluate(() => {
    const days = document.querySelectorAll("gds-calendar-day");
    const available = [];
    const soldOut = [];

    for (const day of days) {
      // 日付: data-date属性 (MM-DD-YYYY形式)
      const dateAttr = day.getAttribute("data-date");
      if (!dateAttr) continue;

      const parts = dateAttr.split("-");
      if (parts.length !== 3) continue;
      const isoDate = parts[2] + "-" + parts[0] + "-" + parts[1]; // YYYY-MM-DD

      // 利用可否: data-disabled属性
      const disabled = day.getAttribute("data-disabled") === "true";

      if (disabled) {
        soldOut.push(isoDate);
        continue;
      }

      // 価格抽出: aria-labelの末尾 ("...日曜日 - 25800" 形式)
      let price = null;
      const btn = day.querySelector("button");
      if (btn) {
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const match = ariaLabel.match(/- (\d+)$/);
        if (match) price = parseInt(match[1], 10);
      }

      // フォールバック: 2番目のgds-eyebrow要素のテキスト
      if (!price) {
        const eyebrows = day.querySelectorAll("gds-eyebrow");
        if (eyebrows.length >= 2) {
          const priceText = (eyebrows[1].textContent || "").trim();
          const num = parseInt(priceText.replace(/,/g, ""), 10);
          if (num >= 5000) price = num;
        }
      }

      // 価格範囲チェック (5,000〜100,000円)
      if (price && price >= 5000 && price <= 100000) {
        available.push({ date: isoDate, price: price });
      }
    }

    return { available, soldOut };
  });
}

/**
 * カレンダーの右矢印ボタンをクリックして次の月に遷移
 * クリック→待機のみ。DOM変化の検出は行わない（WebComponent内部のため検出困難）
 * @return {boolean} クリック成功ならtrue
 */
async function clickNextMonth(page) {
  const NEXT_BTN_SELECTOR = 'button[aria-label="Next Month"]';

  try {
    // ボタンの存在・有効性を確認
    const isClickable = await page.evaluate((sel) => {
      const btn = document.querySelector(sel);
      if (!btn) return false;
      if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return false;
      return true;
    }, NEXT_BTN_SELECTOR);
    if (!isClickable) return false;

    // クリック実行
    await page.click(NEXT_BTN_SELECTOR);

    // SPA再レンダリング待ち
    await sleep(5000);

    return true;
  } catch {
    return false;
  }
}

// === GAS API通信 ===

/**
 * GAS APIに販売中の価格データを送信（DOM抽出データ）
 */
async function postPricesDirectly(gasUrl, apiKey, passId, prices) {
  const body = JSON.stringify({
    action: "updatePricesDirectly",
    apiKey: apiKey,
    data: {
      passId: passId,
      prices: prices,
    },
  });

  const response = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`GAS APIエラー: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * GAS APIに売り切れ日のステータス更新を依頼
 */
async function postMarkDatesAsSoldOut(gasUrl, apiKey, passId, soldOutDates) {
  const body = JSON.stringify({
    action: "markDatesAsSoldOut",
    apiKey: apiKey,
    data: {
      passId: passId,
      dates: soldOutDates,
    },
  });

  const response = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`GAS APIエラー（売切マーク）: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// === ヘルパー ===

/**
 * 枚数セレクタの「+」ボタンをクリック（カレンダー有効化のため）
 */
async function tryClickQuantitySelector(page) {
  try {
    return await page.evaluate(() => {
      // パターン1: gds-quantity コンポーネント内の+ボタン
      const gdsQuantity = document.querySelector("gds-quantity");
      if (gdsQuantity) {
        const plusBtn = gdsQuantity.querySelector("button.plus, button[aria-label*='増'], button:last-child");
        if (plusBtn && !plusBtn.disabled) {
          plusBtn.click();
          return true;
        }
      }

      // パターン2: aria-labelに「枚数」「数量」を含むボタン
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const label = (btn.getAttribute("aria-label") || "") + (btn.textContent || "");
        if (/(\+|増|add|plus|increment)/i.test(label) || btn.textContent.trim() === "+") {
          if (!btn.disabled) {
            btn.click();
            return true;
          }
        }
      }

      // パターン3: input[type="number"] の値を直接変更
      const numInput = document.querySelector("input[type='number']");
      if (numInput) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        ).set;
        nativeInputValueSetter.call(numInput, "1");
        numInput.dispatchEvent(new Event("input", { bubbles: true }));
        numInput.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      return false;
    });
  } catch {
    return false;
  }
}

/**
 * Queue-it 待機処理
 */
async function handleQueueIt(page) {
  const startTime = Date.now();

  while (Date.now() - startTime < QUEUE_IT_TIMEOUT_MS) {
    const currentUrl = page.url();
    if (!currentUrl.includes("queue-it") && !currentUrl.includes("queue.it")) {
      console.log("Queue-it 通過完了");
      await page.waitForNetworkIdle({ timeout: 15000 });
      return;
    }
    console.log(`Queue-it 待機中... (${Math.round((Date.now() - startTime) / 1000)}秒経過)`);
    await sleep(10000);
  }

  throw new Error("Queue-it タイムアウト（120秒）");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 実行
main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
