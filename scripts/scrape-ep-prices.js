/**
 * USJ EP価格ページ スクリーンショット撮影 & Gemini Vision 価格読み取り
 *
 * 使い方:
 *   node scrape-ep-prices.js
 *
 * 環境変数:
 *   GAS_WEB_APP_URL - GASデプロイメントURL
 *   GAS_API_KEY     - PRICE_UPDATE_API_KEY と同じ値
 *
 * 各パスの価格ページを開き、カレンダーのスクリーンショットを撮影
 * → GASに送信 → Gemini Visionが画像から価格を読み取り → 価格マスター更新
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
      const screenshotBase64 = await captureCalendarScreenshot(browser, url);

      if (!screenshotBase64) {
        console.log(`スキップ (${pass.passId}): カレンダーが表示されませんでした`);
        results.push({ passId: pass.passId, success: true, skipped: true });
        continue;
      }

      console.log(`スクショ撮影完了 (${Math.round(screenshotBase64.length / 1024)}KB base64)`);

      // GAS APIにスクショを送信 → Gemini Visionで価格読み取り
      const gasResult = await postScreenshotToGas(GAS_URL, API_KEY, pass.passId, screenshotBase64);
      console.log(`GAS応答: ${JSON.stringify(gasResult)}`);

      if (gasResult.success) {
        results.push({ passId: pass.passId, success: true, result: gasResult });
      } else {
        // Geminiが価格を読み取れなかった場合はスキップ扱い
        if (gasResult.error && gasResult.error.includes("抽出できません")) {
          console.log(`スキップ (${pass.passId}): 価格データなし（販売期間外の可能性）`);
          results.push({ passId: pass.passId, success: true, skipped: true });
        } else {
          throw new Error(gasResult.error || "GAS処理エラー");
        }
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
  const succeeded = results.filter((r) => r.success && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`成功: ${succeeded} / スキップ: ${skipped} / 失敗: ${failed} / 合計: ${results.length}`);

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

/**
 * ページを開いてカレンダー部分のフルページスクリーンショットを撮影
 * @return {string|null} base64文字列、またはカレンダー非表示ならnull
 */
async function captureCalendarScreenshot(browser, url) {
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

    // カレンダー要素の表示を待つ
    try {
      await page.waitForSelector("gds-calendar-day", { timeout: 30000 });
      console.log("カレンダー要素を検出");
    } catch {
      // カレンダー要素が見つからない場合はスキップ
      console.log("カレンダー要素が見つかりません — スキップ");
      return null;
    }

    // 描画完了を待つ
    await sleep(3000);

    // 全日disabledなら枚数セレクタ操作
    let allDisabled = await page.evaluate(() => {
      const days = document.querySelectorAll("gds-calendar-day");
      return Array.from(days).every(d => d.getAttribute("data-disabled") === "true");
    });

    if (allDisabled) {
      console.log("全日disabled — 枚数セレクタ操作を試行");
      const quantityClicked = await tryClickQuantitySelector(page);
      if (quantityClicked) {
        console.log("枚数セレクタをクリック — カレンダー更新待機（8秒）");
        await sleep(8000);
      }

      // 再チェック
      allDisabled = await page.evaluate(() => {
        const days = document.querySelectorAll("gds-calendar-day");
        return Array.from(days).every(d => d.getAttribute("data-disabled") === "true");
      });

      if (allDisabled) {
        console.log("操作後も全日disabled — 販売日程なしと判定");
        // 販売日程なしでもスクショは撮らない（Geminiに送っても意味がない）
        return null;
      }
    }

    // 有効日数を確認
    const enabledCount = await page.evaluate(() => {
      const days = document.querySelectorAll("gds-calendar-day");
      return Array.from(days).filter(d => d.getAttribute("data-disabled") !== "true").length;
    });
    console.log(`有効な日付: ${enabledCount}件`);

    // フルページスクリーンショット撮影（JPEG で容量削減）
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "jpeg",
      quality: 85,
    });

    const base64 = screenshotBuffer.toString("base64");
    return base64;
  } finally {
    await page.close();
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
 * GAS Web App にスクリーンショットをPOST → Gemini Vision で価格読み取り
 */
async function postScreenshotToGas(gasUrl, apiKey, passId, base64) {
  const body = JSON.stringify({
    action: "updatePricesFromScreenshot",
    apiKey: apiKey,
    data: {
      passId: passId,
      base64: base64,
      mimeType: "image/jpeg",
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
