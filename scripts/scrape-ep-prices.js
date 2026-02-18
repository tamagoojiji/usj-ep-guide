/**
 * USJ EP価格ページ スクリーンショット取得 & GAS API送信
 *
 * 使い方:
 *   node scrape-ep-prices.js
 *
 * 環境変数:
 *   GAS_WEB_APP_URL - GASデプロイメントURL
 *   GAS_API_KEY     - PRICE_UPDATE_API_KEY と同じ値
 *
 * 各パスの価格ページURLを設定し、Puppeteerでスクショ→GASにPOST
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

// === 設定 ===

// パス定義: GAS「スクレイピングURL」シートから動的に取得
// ユーザーがスプレッドシートにURLを貼り付けるだけでスクレイピング対象に追加される
let PASS_PAGES = []; // fetchPassPages() で初期化

// セレクタ設定（DOM構造変更時にここを更新）
const SELECTORS = {
  // 価格カレンダーが表示される領域
  calendarArea: '[class*="calendar"], [class*="Calendar"], [class*="price"], [data-testid*="calendar"]',
  // Queue-it待機ページの検出
  queueIt: 'iframe[src*="queue-it"], #queueit',
};

const SCREENSHOT_DIR = path.join(__dirname, "screenshots");
const WAIT_BETWEEN_PAGES_MS = 35000; // Gemini API rate limit対策（20リクエスト/分）
const PAGE_LOAD_TIMEOUT_MS = 60000;
const QUEUE_IT_TIMEOUT_MS = 120000;

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

  // スクショ保存ディレクトリ
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const results = [];

  for (const pass of PASS_PAGES) {
    console.log(`\n--- ${pass.label} (${pass.passId}) ---`);

    try {
      const screenshotPath = path.join(SCREENSHOT_DIR, `${pass.passId}.png`);
      await takeScreenshot(browser, pass.url, screenshotPath);

      // base64エンコード
      const base64 = fs.readFileSync(screenshotPath, { encoding: "base64" });
      console.log(`スクショ取得完了: ${screenshotPath} (${Math.round(base64.length / 1024)}KB base64)`);

      // GAS APIにPOST（quota超過時はリトライ）
      const gasResult = await postToGasWithRetry(GAS_URL, API_KEY, pass.passId, base64);
      console.log(`GAS応答: ${JSON.stringify(gasResult)}`);

      results.push({ passId: pass.passId, success: true, result: gasResult });
    } catch (err) {
      console.error(`エラー (${pass.passId}): ${err.message}`);
      results.push({ passId: pass.passId, success: false, error: err.message });
    }

    // レート制限対策: パス間にウェイト
    if (PASS_PAGES.indexOf(pass) < PASS_PAGES.length - 1) {
      console.log(`${WAIT_BETWEEN_PAGES_MS / 1000}秒待機...`);
      await sleep(WAIT_BETWEEN_PAGES_MS);
    }
  }

  await browser.close();

  // 結果サマリー
  console.log("\n=== 結果サマリー ===");
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`成功: ${succeeded} / 失敗: ${failed} / 合計: ${results.length}`);

  if (failed > 0) {
    console.log("\n失敗したパス:");
    results
      .filter((r) => !r.success)
      .forEach((r) => console.log(`  - ${r.passId}: ${r.error}`));
    process.exit(1);
  }
}

/**
 * ページに移動してスクショを撮る
 */
async function takeScreenshot(browser, url, outputPath) {
  const page = await browser.newPage();

  try {
    // ビューポート設定（カレンダーが見やすいサイズ）
    await page.setViewport({ width: 1280, height: 1024 });

    // ページ遷移（SPAのため domcontentloaded で待つ。networkidle2だとタイムアウトする）
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

    // SPAのレンダリング完了を待つ（まず価格カレンダーを探す）
    try {
      await page.waitForSelector(SELECTORS.calendarArea, { timeout: 30000 });
      console.log("カレンダー要素を検出");
    } catch {
      console.log("カレンダー要素が見つかりません。追加待機してページ全体をスクショします");
    }

    // 追加の描画待ち（JS描画の完了を待つ）
    await sleep(5000);

    // ページ下までスクロールして遅延読み込みコンテンツを発火
    console.log("ページ全体をスクロール中...");
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 500;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 300);
      });
    });
    // トップに戻してからフルページスクショ
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(3000);
    console.log("スクロール完了 — スクショ取得");

    // フルページスクショ
    await page.screenshot({
      path: outputPath,
      fullPage: true,
      type: "png",
    });

    console.log(`スクショ保存: ${outputPath}`);
  } finally {
    await page.close();
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
 * GAS APIにPOST（quota超過時は最大2回リトライ）
 */
async function postToGasWithRetry(gasUrl, apiKey, passId, base64, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await postToGas(gasUrl, apiKey, passId, base64);

    // quota超過エラーならリトライ
    if (!result.success && result.error && result.error.includes("quota")) {
      if (attempt < maxRetries) {
        const waitSec = 60;
        console.log(`Gemini quota超過 — ${waitSec}秒待機してリトライ (${attempt + 1}/${maxRetries})`);
        await sleep(waitSec * 1000);
        continue;
      }
    }

    return result;
  }
}

/**
 * GAS Web App にスクショデータをPOST
 */
async function postToGas(gasUrl, apiKey, passId, base64) {
  const body = JSON.stringify({
    action: "updatePricesFromScreenshot",
    apiKey: apiKey,
    data: {
      passId: passId,
      base64: base64,
      mimeType: "image/png",
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
