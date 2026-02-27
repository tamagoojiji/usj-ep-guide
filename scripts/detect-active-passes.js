/**
 * USJ公式エクスプレス・パス一覧ページから現在販売中のパスを自動検出
 * 検出結果をGASに送信してパスマスターの販売ステータスを更新
 *
 * 使い方:
 *   node detect-active-passes.js          # 検出のみ（dry run）
 *   node detect-active-passes.js --update  # GASに反映
 */

const puppeteer = require("puppeteer");

// USJエクスプレス・パス一覧URL
const EP_LISTING_URL = "https://store.usj.co.jp/ja/jp/c/expresspass/";

async function main() {
  const updateMode = process.argv.includes("--update");
  const GAS_URL = process.env.GAS_WEB_APP_URL;
  const API_KEY = process.env.GAS_API_KEY;

  if (updateMode && (!GAS_URL || !API_KEY)) {
    console.error("--update モードには GAS_WEB_APP_URL / GAS_API_KEY が必要です");
    process.exit(1);
  }

  console.log("USJ公式エクスプレス・パス一覧を取得中...");
  console.log(`モード: ${updateMode ? "検出+GAS更新" : "検出のみ（dry run）"}\n`);

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,1024",
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await page.setViewport({ width: 1280, height: 1024 });

  console.log(`ページ遷移: ${EP_LISTING_URL}`);
  await page.goto(EP_LISTING_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Queue-it チェック
  const currentUrl = page.url();
  if (currentUrl.includes("queue")) {
    console.log("Queue-it 検出 — 60秒待機...");
    await new Promise((r) => setTimeout(r, 60000));
  }

  // SPA描画待ち
  try {
    await page.waitForNetworkIdle({ idleTime: 2000, timeout: 20000 });
  } catch {}
  await new Promise((r) => setTimeout(r, 3000));

  // ページ内のエクスプレス・パスリンクとパス名を全て取得
  const listings = await page.evaluate(() => {
    const results = [];
    // 全リンクからエクスプレス・パスのURLを抽出
    const links = document.querySelectorAll("a[href]");
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      // /expresspass/EXP* or /expresspass/EXPRBID_* パターン
      const match = href.match(/\/expresspass\/(EXP[A-Z0-9_]+)/);
      if (!match) continue;

      const productCode = match[1];
      // リンク内のテキストからパス名を取得
      const text = (link.textContent || "").trim().replace(/\s+/g, " ");

      // 画像のalt属性も確認
      const img = link.querySelector("img");
      const alt = img ? (img.getAttribute("alt") || "") : "";

      results.push({
        productCode: productCode,
        url: href,
        text: text.substring(0, 200),
        alt: alt.substring(0, 200),
      });
    }

    // 重複除去（productCode単位）
    const seen = {};
    const unique = [];
    for (const r of results) {
      if (!seen[r.productCode]) {
        seen[r.productCode] = true;
        unique.push(r);
      }
    }

    return unique;
  });

  console.log(`\n=== 検出結果: ${listings.length}件のパス ===\n`);
  for (const l of listings) {
    const name = l.alt || l.text.substring(0, 80);
    console.log(`  ${l.productCode}: ${name}`);
  }

  // スクレイピングURL一覧と照合するため、GASからURL一覧を取得
  if (GAS_URL) {
    console.log("\nスクレイピングURLと照合中...");
    const apiUrl = GAS_URL + "?action=getScrapingUrls";
    const response = await fetch(apiUrl, { redirect: "follow" });
    const data = await response.json();

    if (data.success && data.urls) {
      const activeProductCodes = new Set(listings.map((l) => l.productCode));

      // 各スクレイピングURLのproductCodeを抽出して照合
      const matchResults = [];
      for (const u of data.urls) {
        const match = u.url.match(/\/(EXP[A-Z0-9_]+)/);
        const code = match ? match[1] : null;
        const isActive = code ? activeProductCodes.has(code) : false;
        matchResults.push({
          passId: u.passId,
          label: u.label,
          productCode: code,
          isActive: isActive,
        });
      }

      console.log(`\n=== パスマスター照合結果 ===\n`);
      const active = matchResults.filter((r) => r.isActive);
      const inactive = matchResults.filter((r) => !r.isActive);

      console.log(`販売中（${active.length}件）:`);
      for (const a of active) {
        console.log(`  ✅ ${a.passId}: ${a.label} (${a.productCode})`);
      }

      console.log(`\n販売停止の可能性（${inactive.length}件）:`);
      for (const i of inactive) {
        console.log(`  ❌ ${i.passId}: ${i.label} (${i.productCode || "コード不明"})`);
      }

      // GAS更新モード
      if (updateMode) {
        console.log("\nGASに販売ステータスを送信中...");
        const activePassIds = active.map((a) => a.passId);
        const inactivePassIds = inactive.map((i) => i.passId);

        const body = JSON.stringify({
          action: "updateSalesStatus",
          apiKey: API_KEY,
          data: {
            activePassIds: activePassIds,
            inactivePassIds: inactivePassIds,
            detectedProductCodes: listings.map((l) => l.productCode),
          },
        });

        const updateResponse = await fetch(GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          redirect: "follow",
        });

        const updateResult = await updateResponse.json();
        console.log(`GAS応答: ${JSON.stringify(updateResult)}`);
      }
    }
  }

  await browser.close();
  console.log("\n完了");
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});
