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

// パス定義: passId → 価格ページURL
// URLはUSJ公式ストアの各EP価格カレンダーページ
// ※ URL変更時はここを更新する
// テスト用: まず2パスで動作確認。URL確定後に全16パスを追加する
const PASS_PAGES = [
  {
    passId: "premium",
    url: "https://store.usj.co.jp/ja/jp/c/expresspass/EXPRBID_25?config=true",
    label: "プレミアム",
  },
  {
    passId: "ep7_trolley_selection",
    url: "https://store.usj.co.jp/ja/jp/c/expresspass/EXP0068?config=true",
    label: "EP7 トロッコ＆セレクション",
  },
  // --- 以下、URL確定後に追加 ---
  // { passId: "ep4_minion_hollywood", url: "https://store.usj.co.jp/ja/jp/c/expresspass/???", label: "EP4 ミニオン＆ハリウッド" },
  // { passId: "ep4_race_trolley", url: "...", label: "EP4 レース＆トロッコ" },
  // { passId: "ep4_trolley_jaws", url: "...", label: "EP4 トロッコ＆ジョーズ" },
  // { passId: "ep4_race_jaws", url: "...", label: "EP4 レース＆ジョーズ" },
  // { passId: "ep4_dino_4d", url: "...", label: "EP4 フラダイ＆4-D" },
  // { passId: "ep4_minion_adventure", url: "...", label: "EP4 ミニオン＆アドベンチャー" },
  // { passId: "ep4_space_minion_mission", url: "...", label: "EP4 スペファン＆ミニオンHM" },
  // { passId: "ep4_space_minion", url: "...", label: "EP4 スペファン＆ミニオン" },
  // { passId: "ep4_dino_jurassic", url: "...", label: "EP4 フラダイ＆ジュラパ" },
  // { passId: "ep4_adventure_race", url: "...", label: "EP4 アドベンチャー＆レース" },
  // { passId: "ep4_trolley_jurassic", url: "...", label: "EP4 トロッコ＆ジュラパ" },
  // { passId: "ep4_minion_theater", url: "...", label: "EP4 ミニオン＆シアター" },
  // { passId: "ep4_race_theater", url: "...", label: "EP4 レース＆シアター" },
  // { passId: "ep4_backdrop_race", url: "...", label: "EP4 バックドロップ＆レース" },
];

// セレクタ設定（DOM構造変更時にここを更新）
const SELECTORS = {
  // 価格カレンダーが表示される領域
  calendarArea: '[class*="calendar"], [class*="Calendar"], [class*="price"], [data-testid*="calendar"]',
  // Queue-it待機ページの検出
  queueIt: 'iframe[src*="queue-it"], #queueit',
};

const SCREENSHOT_DIR = path.join(__dirname, "screenshots");
const WAIT_BETWEEN_PAGES_MS = 3000;
const PAGE_LOAD_TIMEOUT_MS = 60000;
const QUEUE_IT_TIMEOUT_MS = 120000;

// === メイン処理 ===

async function main() {
  const GAS_URL = process.env.GAS_WEB_APP_URL;
  const API_KEY = process.env.GAS_API_KEY;

  if (!GAS_URL || !API_KEY) {
    console.error("環境変数 GAS_WEB_APP_URL / GAS_API_KEY が未設定です");
    process.exit(1);
  }

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

      // GAS APIにPOST
      const gasResult = await postToGas(GAS_URL, API_KEY, pass.passId, base64);
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
