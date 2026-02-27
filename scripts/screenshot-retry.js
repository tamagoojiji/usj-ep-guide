/**
 * 失敗した2URLを再試行 + 全結果をGASへ送信
 */
const puppeteer = require("puppeteer");

// 前回の結果（成功分）
const knownResults = {
  "50028": { from: "2026-02-27", to: "2026-03-31" },
  "50015": { from: "2026-04-01", to: "2026-04-30" },
  "50029": { from: "2026-02-27", to: "2026-03-31" },
  "50030": { from: "2026-02-27", to: "2026-03-31" },
  "50018": { from: "2026-04-01", to: "2026-04-30" },
  "50017": { from: "2026-04-01", to: "2026-04-30" },
};

// 再試行対象
const RETRY_URLS = [
  { lCodes: ["50031"], name: "EP4 ダイナソー＆4-D", url: "https://l-tike.com/search/?lcd=50031" },
  { lCodes: ["50027", "50016"], name: "EP4 4-D＆バックドロップ", url: "https://l-tike.com/search/?lcd=50027%2C50016" },
];

async function scrapePage(target) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-http2", "--window-size=1280,900"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(target.url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 5000));

    const result = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const periodRegex = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[（(][^）)]+[）)]\s*[～〜]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/g;
      const entries = [];
      let match;
      while ((match = periodRegex.exec(text)) !== null) {
        entries.push({
          from: `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`,
          to: `${match[4]}-${String(match[5]).padStart(2, "0")}-${String(match[6]).padStart(2, "0")}`,
        });
      }
      return entries;
    });

    await page.close();
    return result;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function main() {
  console.log("=== 失敗URL再試行 + GAS反映 ===\n");

  const allResults = { ...knownResults };

  for (const target of RETRY_URLS) {
    console.log(`${target.name}: ${target.url}`);
    try {
      const periods = await scrapePage(target);
      console.log(`  公演期間: ${JSON.stringify(periods)}`);
      for (let i = 0; i < target.lCodes.length && i < periods.length; i++) {
        allResults[target.lCodes[i]] = periods[i];
      }
    } catch (e) {
      console.log(`  エラー: ${e.message.substring(0, 100)}`);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }

  // 結果表示
  console.log("\n=== 全Lコード公演日程 ===");
  for (const [lc, data] of Object.entries(allResults).sort()) {
    console.log(`  ${lc}: ${data.from} ～ ${data.to}`);
  }

  // GASへ反映
  const GAS_URL = process.env.GAS_WEB_APP_URL || process.env.GAS_ENDPOINT;
  const API_KEY = process.env.GAS_API_KEY || process.env.PRICE_UPDATE_API_KEY;

  if (!GAS_URL || !API_KEY) {
    console.log("\n環境変数未設定。手動でGASに入力してください。");
    return;
  }

  console.log("\n=== GASへ送信 ===");
  const items = Object.entries(allResults).map(([lCode, data]) => ({
    lCode,
    passId: "",
    passName: "",
    salesStatus: "販売中",
    salesFrom: "",
    salesTo: "",
    performanceFrom: data.from,
    performanceTo: data.to,
    minPrice: null,
  }));

  const response = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateLawsonData", apiKey: API_KEY, data: items }),
    redirect: "manual",
  });

  if (response.status === 302 || response.status === 301) {
    const r2 = await fetch(response.headers.get("location"), { redirect: "follow" });
    console.log(`  GAS応答: ${await r2.text()}`);
  } else {
    console.log(`  GAS応答: ${await response.text()}`);
  }

  console.log("\n完了");
}

main().catch(console.error);
