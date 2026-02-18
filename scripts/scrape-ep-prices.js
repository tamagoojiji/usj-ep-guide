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

const WAIT_BETWEEN_PAGES_MS = 5000;
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

  // スクレイピングURL一覧をGASから取得
  PASS_PAGES = await fetchPassPages(GAS_URL);

  if (PASS_PAGES.length === 0) {
    console.log("スクレイピング対象のURLがありません。スプレッドシートにURLを登録してください。");
    process.exit(0);
  }

  console.log(`\nスクレイピング対象: ${PASS_PAGES.length}パス`);
  PASS_PAGES.forEach((p, i) => console.log(`  ${i + 1}. ${p.label} (${p.passId})`));

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=AutomationControlled",
      "--disable-infobars",
    ],
  });

  const results = [];

  for (const pass of PASS_PAGES) {
    console.log(`\n--- ${pass.label} (${pass.passId}) ---`);

    try {
      const url = ensureConfigParam(pass.url);
      const prices = await extractPricesFromPage(browser, url);
      console.log(`価格抽出完了: ${prices.length}件`);

      if (prices.length === 0) {
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
 */
async function extractPricesFromPage(browser, url) {
  const page = await browser.newPage();

  try {
    // headless検知回避: User-Agent偽装 + navigator.webdriver上書き
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      // Chrome DevTools Protocol検知回避
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
      // permissions API偽装
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    });
    await page.setViewport({ width: 1280, height: 1024 });

    // ページ遷移（domcontentloadedで初回待ち）
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

    // SPAの完全描画を待つ（networkidleでJSの非同期ロード完了を確認）
    try {
      await page.waitForNetworkIdle({ idleTime: 2000, timeout: 20000 });
    } catch {
      // タイムアウトしても続行（ネットワークが完全に止まらないサイトもある）
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

    // 全日disabledなら枚数セレクタ操作 + 追加待機（SPAの遅延レンダリング対応）
    let allDisabled = await page.evaluate(() => {
      const days = document.querySelectorAll("gds-calendar-day");
      return Array.from(days).every(d => d.getAttribute("data-disabled") === "true");
    });
    if (allDisabled) {
      console.log("全日disabled — 枚数セレクタ操作を試行");

      // 枚数セレクタの「+」ボタンをクリック（数量1にする）
      const quantityClicked = await tryClickQuantitySelector(page);
      if (quantityClicked) {
        console.log("枚数セレクタをクリック — カレンダー更新待機（8秒）");
        await sleep(8000);

        // 再チェック
        allDisabled = await page.evaluate(() => {
          const days = document.querySelectorAll("gds-calendar-day");
          return Array.from(days).every(d => d.getAttribute("data-disabled") === "true");
        });
      }

      if (allDisabled) {
        console.log("枚数セレクタ操作後も全日disabled — スクロール待機（追加10秒）");
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(5000);
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(5000);

        // 再チェック
        allDisabled = await page.evaluate(() => {
          const days = document.querySelectorAll("gds-calendar-day");
          return Array.from(days).every(d => d.getAttribute("data-disabled") === "true");
        });
        if (allDisabled) {
          // デバッグ: ページ構造 + iframe詳細を出力
          const debugInfo = await page.evaluate(() => {
            const info = {};
            info.title = document.title;
            info.calendarDays = document.querySelectorAll("gds-calendar-day").length;
            info.gdsQuantity = !!document.querySelector("gds-quantity");
            info.buttons = document.querySelectorAll("button").length;
            info.inputs = document.querySelectorAll("input").length;
            info.mainContent = !!document.querySelector("main, [role='main'], .main-content");
            info.bodyTextLength = document.body.innerText.length;
            // iframe詳細
            const iframes = document.querySelectorAll("iframe");
            info.iframes = [];
            for (const iframe of iframes) {
              const iframeInfo = {
                src: iframe.src || "(empty)",
                id: iframe.id || "(none)",
                width: iframe.width,
                height: iframe.height,
              };
              try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                iframeInfo.hasContent = !!iframeDoc;
                iframeInfo.bodyLength = iframeDoc ? iframeDoc.body.innerText.length : 0;
                iframeInfo.calendarDays = iframeDoc ? iframeDoc.querySelectorAll("gds-calendar-day").length : 0;
              } catch {
                iframeInfo.crossOrigin = true;
              }
              info.iframes.push(iframeInfo);
            }
            // ボタンテキスト一覧（最初の20個）
            const btns = document.querySelectorAll("button");
            info.buttonTexts = Array.from(btns).slice(0, 20).map(b =>
              (b.textContent || "").trim().substring(0, 40)
            );
            return info;
          });
          console.log("追加待機後も全日disabled — 詳細:", JSON.stringify(debugInfo));

          // iframe内のカレンダーを探す
          const iframePrices = await extractPricesFromIframes(page);
          if (iframePrices.length > 0) {
            console.log(`iframe内から${iframePrices.length}件の価格を検出`);
            return iframePrices;
          }

          // 最終手段: ページリロードしてネットワークレスポンスからAPI価格を抽出
          console.log("API応答から価格抽出を試行（ページリロード）");
          const apiPrices = await extractPricesFromApiResponses(page, page.url());
          if (apiPrices.length > 0) {
            console.log(`API応答から${apiPrices.length}件の価格を検出`);
            return apiPrices;
          }
        }
      }
    }

    // 現在表示中の月から価格を抽出
    const allPrices = new Map();

    let consecutiveEmpty = 0;

    for (let nav = 0; nav <= MAX_MONTH_NAVIGATIONS; nav++) {
      const monthPrices = await extractCurrentMonthPrices(page);
      console.log(`  月${nav + 1}: ${monthPrices.length}件の価格を抽出`);

      if (monthPrices.length === 0) {
        consecutiveEmpty++;
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

      if (nav === MAX_MONTH_NAVIGATIONS) break;

      const navigated = await navigateToNextMonth(page);
      if (!navigated) {
        console.log("  次の月への移動不可 — 抽出終了");
        break;
      }

      await sleep(2000);
    }

    const result = Array.from(allPrices.entries())
      .map(([date, price]) => ({ date, price }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return result;
  } finally {
    await page.close();
  }
}

/**
 * ネットワークレスポンスを傍受して価格データを含むAPI応答を抽出
 */
async function extractPricesFromApiResponses(page, url) {
  const apiResponses = [];

  // レスポンスリスナーを設定
  const responseHandler = async (response) => {
    const responseUrl = response.url();
    // 価格データを含む可能性のあるAPI呼び出しをキャプチャ
    if (
      responseUrl.includes("api") ||
      responseUrl.includes("price") ||
      responseUrl.includes("calendar") ||
      responseUrl.includes("product") ||
      responseUrl.includes("availability") ||
      responseUrl.includes("config") ||
      responseUrl.includes("graphql") ||
      (responseUrl.includes("store.usj") && response.request().resourceType() === "xhr") ||
      (responseUrl.includes("store.usj") && response.request().resourceType() === "fetch")
    ) {
      try {
        const text = await response.text();
        if (text.length > 50 && text.length < 500000) {
          apiResponses.push({ url: responseUrl, body: text });
        }
      } catch {
        // レスポンスボディ取得失敗は無視
      }
    }
  };

  page.on("response", responseHandler);

  try {
    // ページをリロードしてAPI呼び出しをキャプチャ
    await page.reload({ waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
    try {
      await page.waitForNetworkIdle({ idleTime: 3000, timeout: 30000 });
    } catch {}
    await sleep(5000);

    console.log(`  キャプチャしたAPIレスポンス: ${apiResponses.length}件`);

    // APIレスポンス内のURLをログ出力（デバッグ用）
    for (const resp of apiResponses) {
      const shortUrl = resp.url.substring(0, 100);
      const hasPrice = /price|金額|\d{4,5}/.test(resp.body);
      const hasDate = /\d{4}-\d{2}-\d{2}|date/.test(resp.body);
      console.log(`  API: ${shortUrl} (len=${resp.body.length}, hasPrice=${hasPrice}, hasDate=${hasDate})`);
    }

    // 価格データを含むレスポンスを探す
    for (const resp of apiResponses) {
      try {
        const data = JSON.parse(resp.body);
        const prices = findPricesInJson(data);
        if (prices.length > 0) {
          console.log(`  価格データ発見: ${resp.url.substring(0, 80)} → ${prices.length}件`);
          return prices;
        }
      } catch {
        // JSONパース失敗は無視
      }
    }

    return [];
  } finally {
    page.off("response", responseHandler);
  }
}

/**
 * JSONオブジェクト内の価格データを再帰的に探索
 */
function findPricesInJson(obj, depth = 0) {
  if (depth > 10 || !obj) return [];

  // 配列の場合: 各要素を検査
  if (Array.isArray(obj)) {
    // [{date: "...", price: N}] パターン
    const prices = [];
    for (const item of obj) {
      if (item && typeof item === "object") {
        const dateVal = item.date || item.Date || item.startDate || item.day;
        const priceVal = item.price || item.Price || item.amount || item.unitPrice || item.adultPrice;
        if (dateVal && priceVal && typeof priceVal === "number" && priceVal >= 5000 && priceVal <= 100000) {
          const dateStr = String(dateVal).substring(0, 10); // YYYY-MM-DD
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            prices.push({ date: dateStr, price: priceVal });
          }
        }
      }
    }
    if (prices.length > 0) return prices;

    // 各要素を再帰的に探索
    for (const item of obj) {
      const found = findPricesInJson(item, depth + 1);
      if (found.length > 0) return found;
    }
    return [];
  }

  // オブジェクトの場合: 各値を再帰的に探索
  if (typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      const found = findPricesInJson(obj[key], depth + 1);
      if (found.length > 0) return found;
    }
  }

  return [];
}

/**
 * iframe内のカレンダーから価格を抽出
 */
async function extractPricesFromIframes(page) {
  try {
    const frames = page.frames();
    console.log(`  iframe数: ${frames.length}（メインフレーム含む）`);

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (frame === page.mainFrame()) continue;

      try {
        const frameUrl = frame.url();
        console.log(`  iframe[${i}]: ${frameUrl.substring(0, 80)}`);

        const calendarDays = await frame.evaluate(() => {
          return document.querySelectorAll("gds-calendar-day").length;
        }).catch(() => 0);

        if (calendarDays > 0) {
          console.log(`  iframe[${i}]にカレンダー要素${calendarDays}個を検出`);

          const prices = await frame.evaluate(() => {
            const result = [];
            const days = document.querySelectorAll("gds-calendar-day");
            for (const day of days) {
              if (day.getAttribute("data-disabled") === "true") continue;
              const dataDate = day.getAttribute("data-date");
              if (!dataDate) continue;
              const button = day.querySelector("button[aria-label]");
              if (!button) continue;
              const ariaLabel = button.getAttribute("aria-label");
              if (!ariaLabel) continue;
              const priceMatch = ariaLabel.match(/\s-\s(\d+)$/);
              if (!priceMatch) continue;
              const price = parseInt(priceMatch[1], 10);
              if (price < 5000 || price > 100000) continue;
              const parts = dataDate.split("-");
              if (parts.length !== 3) continue;
              const dateStr = `${parts[2]}-${parts[0]}-${parts[1]}`;
              result.push({ date: dateStr, price: price });
            }
            return result;
          });

          if (prices.length > 0) return prices;
        }
      } catch {
        // cross-origin iframe — skip
      }
    }
    return [];
  } catch {
    return [];
  }
}

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
 * 現在表示中のカレンダーから価格を抽出
 */
async function extractCurrentMonthPrices(page) {
  return await page.evaluate(() => {
    const prices = [];
    const days = document.querySelectorAll("gds-calendar-day");

    for (const day of days) {
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
 */
async function navigateToNextMonth(page) {
  try {
    const clicked = await page.evaluate(() => {
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
