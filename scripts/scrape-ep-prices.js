/**
 * USJ EP価格ページ DOM直接抽出 & GAS API送信
 *
 * 使い方:
 *   node scrape-ep-prices.js
 *
 * 環境変数:
 *   GAS_WEB_APP_URL - GASデプロイメントURL
 *   GAS_API_KEY     - PRICE_UPDATE_API_KEY と同じ値
 *
 * 各パスの価格ページを開き、aria-label属性から価格を直接抽出→GASにPOST
 */

const puppeteer = require("puppeteer");

// === 設定 ===

// パス定義: GAS「スクレイピングURL」シートから動的に取得
let PASS_PAGES = []; // fetchPassPages() で初期化

const WAIT_BETWEEN_PAGES_MS = 5000; // Gemini不使用のため短縮
const PAGE_LOAD_TIMEOUT_MS = 60000;
const QUEUE_IT_TIMEOUT_MS = 120000;
const MAX_MONTH_NAVIGATIONS = 5; // 最大月送り回数

// === メイン処理 ===

/**
 * GAS APIから「スクレイピングURL」シートのURL一覧を取得
 */
async function fetchPassPages(gasUrl) {
  const apiUrl = gasUrl + "?action=getScrapingUrls";
  console.log("GAS APIからスクレイピングURL一覧を取得...");

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

async function main() {
  const GAS_URL = process.env.GAS_WEB_APP_URL;
  const API_KEY = process.env.GAS_API_KEY;

  if (!GAS_URL || !API_KEY) {
    console.error("環境変数 GAS_WEB_APP_URL / GAS_API_KEY が未設定です");
    process.exit(1);
  }

  // スクレイピングURL一覧をGASから取得
  PASS_PAGES = await fetchPassPages(GAS_URL);

  if (PASS_PAGES.length === 0) {
    console.log("スクレイピング対象のURLがありません。スプレッドシートにURLを登録してください。");
    process.exit(0);
  }

  console.log(`\nスクレイピング対象: ${PASS_PAGES.length}パス`);
  PASS_PAGES.forEach((p, i) => console.log(`  ${i + 1}. ${p.label} (${p.passId})`));

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const results = [];

  for (const pass of PASS_PAGES) {
    console.log(`\n--- ${pass.label} (${pass.passId}) ---`);

    try {
      const prices = await extractPricesFromPage(browser, pass.url);
      console.log(`価格抽出完了: ${prices.length}件`);

      if (prices.length === 0) {
        // 売り切れ・販売期間外の場合は警告のみ（エラーにしない）
        console.log(`スキップ (${pass.passId}): 販売中の日程なし（売り切れまたは販売期間外）`);
        results.push({ passId: pass.passId, success: true, skipped: true });
        continue;
      }

      // GAS APIにPOST
      const gasResult = await postToGas(GAS_URL, API_KEY, pass.passId, prices);
      console.log(`GAS応答: ${JSON.stringify(gasResult)}`);

      results.push({ passId: pass.passId, success: true, result: gasResult });
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
  const succeeded = results.filter((r) => r.success && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`成功: ${succeeded} / スキップ: ${skipped} / 失敗: ${failed} / 合計: ${results.length}`);

  if (skipped > 0) {
    console.log("\nスキップしたパス（販売中の日程なし）:");
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

/**
 * ページを開いてカレンダーDOMから価格を直接抽出（複数月対応）
 * @param {Browser} browser - Puppeteerブラウザインスタンス
 * @param {string} url - 価格ページURL
 * @return {Array<{date: string, price: number}>} 抽出された価格データ
 */
async function extractPricesFromPage(browser, url) {
  const page = await browser.newPage();

  try {
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

    // カレンダー要素の表示を待つ
    try {
      await page.waitForSelector("gds-calendar-day", { timeout: 30000 });
      console.log("カレンダー要素を検出");
    } catch {
      throw new Error("カレンダー要素（gds-calendar-day）が見つかりません");
    }

    // 描画完了を待つ
    await sleep(3000);

    // 全日disabled（枚数未選択）の場合、枚数「+」ボタンをクリック
    const allDisabled = await page.evaluate(() => {
      const days = document.querySelectorAll("gds-calendar-day");
      return Array.from(days).every(d => d.getAttribute("data-disabled") === "true");
    });
    if (allDisabled) {
      console.log("全日disabled — 枚数選択を試行");
      const clicked = await page.evaluate(() => {
        // gds-quantity の「+」ボタンを探す
        const plusBtn = document.querySelector("gds-quantity button.plus, gds-quantity button[aria-label*='増'], gds-quantity button:last-of-type");
        if (plusBtn) { plusBtn.click(); return true; }
        return false;
      });
      if (clicked) {
        console.log("枚数+ボタンをクリック — カレンダー更新を待機");
        await sleep(3000);
      }
    }

    // 現在表示中の月から価格を抽出
    const allPrices = new Map(); // 重複排除用: date → price

    let consecutiveEmpty = 0; // 連続で0件の月数

    for (let nav = 0; nav <= MAX_MONTH_NAVIGATIONS; nav++) {
      const monthPrices = await extractCurrentMonthPrices(page);
      console.log(`  月${nav + 1}: ${monthPrices.length}件の価格を抽出`);

      if (monthPrices.length === 0) {
        consecutiveEmpty++;
        // 価格のある月を過ぎた後に2回連続で0件なら終了
        if (consecutiveEmpty >= 2 && allPrices.size > 0) {
          console.log("  価格付き日付なし（連続2回） — 抽出終了");
          break;
        }
      } else {
        consecutiveEmpty = 0;
      }

      for (const item of monthPrices) {
        allPrices.set(item.date, item.price);
      }

      // 最後の月なら次へ進まない
      if (nav === MAX_MONTH_NAVIGATIONS) break;

      // 右矢印ボタンで次の月へ
      const navigated = await navigateToNextMonth(page);
      if (!navigated) {
        console.log("  次の月への移動不可 — 抽出終了");
        break;
      }

      // 月送り後の描画待ち
      await sleep(2000);
    }

    // Map → 配列に変換してソート
    const result = Array.from(allPrices.entries())
      .map(([date, price]) => ({ date, price }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return result;
  } finally {
    await page.close();
  }
}

/**
 * 現在表示中のカレンダーから価格を抽出
 * @param {Page} page - Puppeteerページ
 * @return {Array<{date: string, price: number}>}
 */
async function extractCurrentMonthPrices(page) {
  return await page.evaluate(() => {
    const prices = [];
    const days = document.querySelectorAll("gds-calendar-day");

    for (const day of days) {
      // 無効（過去日/非販売日）はスキップ
      if (day.getAttribute("data-disabled") === "true") continue;

      const dataDate = day.getAttribute("data-date");
      if (!dataDate) continue;

      // aria-labelは内部のbutton要素にある
      const button = day.querySelector("button[aria-label]");
      if (!button) continue;

      const ariaLabel = button.getAttribute("aria-label");
      if (!ariaLabel) continue;

      // aria-label例: "2026年3月1日日曜日 - 23800"
      const priceMatch = ariaLabel.match(/\s-\s(\d+)$/);
      if (!priceMatch) continue;

      const price = parseInt(priceMatch[1], 10);
      if (price < 5000 || price > 100000) continue;

      // data-date は "MM-DD-YYYY" 形式 → "YYYY-MM-DD" に変換
      const parts = dataDate.split("-");
      if (parts.length !== 3) continue;
      const dateStr = `${parts[2]}-${parts[0]}-${parts[1]}`;

      prices.push({ date: dateStr, price: price });
    }

    return prices;
  });
}

/**
 * 右矢印ボタンで次の月に移動
 * @param {Page} page - Puppeteerページ
 * @return {boolean} 移動できたかどうか
 */
async function navigateToNextMonth(page) {
  try {
    const clicked = await page.evaluate(() => {
      // gds-buttons.right-arrow 内の button を探す
      const rightArrow = document.querySelector("gds-buttons.right-arrow button");
      if (rightArrow && !rightArrow.disabled) {
        rightArrow.click();
        return true;
      }
      return false;
    });
    return clicked;
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

/**
 * GAS Web App に価格データをPOST
 */
async function postToGas(gasUrl, apiKey, passId, prices) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 実行
main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
