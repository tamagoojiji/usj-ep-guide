/**
 * ローチケ EP販売情報スクレイパー
 *
 * 使い方:
 *   node scripts/scrape-lawson.js
 *
 * 環境変数:
 *   GAS_WEB_APP_URL - GASデプロイメントURL（GAS_ENDPOINTでもOK）
 *   GAS_API_KEY     - PRICE_UPDATE_API_KEY と同じ値
 *
 * 処理フロー:
 * 1. ローチケ EP一覧ページをスクレイプ（パス名、Lコード、最低価格）
 * 2. ローカル取得済みの公演日程を付加
 * 3. passIdマッピング（キーワードマッチ）
 * 4. GASへPOST送信
 */

const puppeteer = require("puppeteer");

// === 設定 ===
const EP_LIST_URL = "https://l-tike.com/leisure/usj/express_pass/";

// === Lコード別公演日程（ローカルPuppeteerで取得済み 2026-02-27） ===
// ローチケ検索ページ（headless:false）から抽出
const PERFORMANCE_DATES = {
  "50028": { from: "2026-02-27", to: "2026-03-31", salesTo: "2026-03-30" },
  "50015": { from: "2026-04-01", to: "2026-04-30", salesTo: "2026-05-30" },
  "50029": { from: "2026-02-27", to: "2026-03-31", salesTo: "2026-03-30" },
  "50030": { from: "2026-02-27", to: "2026-03-31", salesTo: "2026-03-30" },
  "50031": { from: "2026-02-27", to: "2026-03-20", salesTo: "2026-03-19" },
  "50027": { from: "2026-03-21", to: "2026-03-31", salesTo: "2026-03-30" },
  "50016": { from: "2026-04-01", to: "2026-04-30", salesTo: "2026-05-30" },
  "50018": { from: "2026-04-01", to: "2026-04-30", salesTo: "2026-05-30" },
  "50017": { from: "2026-04-01", to: "2026-04-30", salesTo: "2026-05-30" },
};

// === passId マッピング ===
const PASS_ID_MAPPING = [
  { keywords: ["プレミアム"], passId: "premium" },
  { keywords: ["バラエティ・スタンダード"], passId: "ep7_trolley_selection" },
  { keywords: ["トロッコ", "セレクション"], passId: "ep7_trolley_selection" },
  { keywords: ["XRライド", "セレクション"], passId: "ep7_trolley_selection" },
  { keywords: ["ミニオン", "ハリウッド・ドリーム"], passId: "ep4_minion_hollywood" },
  { keywords: ["レース", "トロッコ"], passId: "ep4_race_trolley" },
  { keywords: ["トロッコ", "ジョーズ"], passId: "ep4_trolley_jaws" },
  { keywords: ["レース", "ジョーズ"], passId: "ep4_race_jaws" },
  { keywords: ["ダイナソー", "4-D"], passId: "ep4_dino_4d" },
  { keywords: ["ミニオン", "アドベンチャー"], passId: "ep4_minion_adventure" },
  { keywords: ["スペース", "ミッション"], passId: "ep4_space_minion_mission" },
  { keywords: ["スペース", "ミニオン"], passId: "ep4_space_minion" },
  { keywords: ["ダイナソー", "ジュラシック"], passId: "ep4_dino_jurassic" },
  { keywords: ["アドベンチャー", "レース"], passId: "ep4_adventure_race" },
  { keywords: ["トロッコ", "ジュラシック"], passId: "ep4_trolley_jurassic" },
  { keywords: ["ミニオン", "シアター"], passId: "ep4_minion_theater" },
  { keywords: ["レース", "シアター"], passId: "ep4_race_theater" },
  { keywords: ["バックドロップ", "レース"], passId: "ep4_backdrop_race" },
  { keywords: ["4-D", "バックドロップ"], passId: "ep4_4d_backdrop" },
  { keywords: ["トロッコ", "ファン"], passId: "ep4_trolley_fun" },
  { keywords: ["ファン・バラエティ"], passId: "ep4_fun_variety" },
];

function matchPassId(passName) {
  const name = passName || "";
  for (const mapping of PASS_ID_MAPPING) {
    if (mapping.keywords.every((kw) => name.includes(kw))) return mapping.passId;
  }
  return null;
}

// === メイン処理 ===
async function main() {
  const GAS_URL = process.env.GAS_WEB_APP_URL || process.env.GAS_ENDPOINT;
  const API_KEY = process.env.GAS_API_KEY || process.env.PRICE_UPDATE_API_KEY;

  if (!GAS_URL || !API_KEY) {
    console.error("環境変数 GAS_WEB_APP_URL / GAS_API_KEY が未設定です");
    process.exit(1);
  }

  console.log("=== ローチケ EP販売情報スクレイパー ===\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-http2"],
  });

  try {
    // Step 1: EP一覧ページからパス情報を取得
    console.log("Step 1: EP一覧ページをスクレイプ...");
    const passList = await scrapeEpListPage(browser);
    console.log(`  ${passList.length}件のパスを検出\n`);

    if (passList.length === 0) {
      console.log("パスが見つかりませんでした。");
      process.exit(0);
    }

    // Step 2: passIdマッピング + 公演日程付加 + データ整形
    console.log("Step 2: passIdマッピング + 公演日程付加...\n");
    const dataList = passList.map((pass) => {
      const passId = matchPassId(pass.passName);
      const dates = PERFORMANCE_DATES[pass.lCode] || {};
      console.log(
        `  ${pass.passName} (${pass.lCode}) → ${passId || "(新規)"}` +
        (dates.from ? ` [${dates.from}～${dates.to}]` : " [日程なし]")
      );
      return {
        passId: passId || "",
        lCode: pass.lCode,
        passName: pass.passName,
        salesStatus: "販売中",
        salesFrom: "",
        salesTo: dates.salesTo || "",
        performanceFrom: dates.from || "",
        performanceTo: dates.to || "",
        minPrice: pass.minPrice || null,
      };
    });

    // Step 3: GASへPOST送信
    console.log(`\nStep 3: GASへデータ送信 (${dataList.length}件)...`);
    const gasResult = await postToGas(GAS_URL, API_KEY, dataList);
    console.log(`  GAS応答: ${JSON.stringify(gasResult)}`);

    // サマリー
    console.log("\n=== 結果サマリー ===");
    const mapped = dataList.filter((d) => d.passId).length;
    const unmapped = dataList.filter((d) => !d.passId).length;
    const withDates = dataList.filter((d) => d.performanceFrom).length;
    console.log(`合計: ${dataList.length}件 (既存パス: ${mapped}, 予告パス: ${unmapped}, 日程付き: ${withDates})`);
    dataList.forEach((d) => {
      const price = d.minPrice ? `¥${d.minPrice.toLocaleString()}~` : "価格未定";
      const id = d.passId || "(新規)";
      const period = d.performanceFrom ? `${d.performanceFrom}～${d.performanceTo}` : "日程不明";
      console.log(`  ${d.passName} [${d.salesStatus}] ${price} ${period} → ${id}`);
    });

  } finally {
    await browser.close();
  }
}

/**
 * EP一覧ページをスクレイプ
 */
async function scrapeEpListPage(browser) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.goto(EP_LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(8000);

    return await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      const links = document.querySelectorAll('a[href*="lcd="]');

      links.forEach((link) => {
        const href = link.getAttribute("href") || "";
        const lcdParam = href.match(/lcd=([^&]+)/i);
        if (!lcdParam) return;

        const lCodes = decodeURIComponent(lcdParam[1]).split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
        if (lCodes.length === 0) return;

        let passName = "";

        // リンクの直前の兄弟要素からパス名を探す
        let prevEl = link.previousElementSibling;
        for (let i = 0; i < 10 && prevEl; i++) {
          const text = prevEl.textContent || "";
          const nameMatch = text.match(/(ユニバーサル・エクスプレス・パス\s*\d+\s*～[^～]+～)/);
          if (nameMatch) {
            passName = nameMatch[1].trim().replace(/\s+/g, " ");
            break;
          }
          prevEl = prevEl.previousElementSibling;
        }

        // 親要素のテキストから探す
        if (!passName) {
          let parent = link.parentElement;
          for (let i = 0; i < 3 && parent; i++) {
            const text = parent.textContent || "";
            const nameMatch = text.match(/(ユニバーサル・エクスプレス・パス\s*\d+\s*～[^～]+～)/);
            if (nameMatch) {
              passName = nameMatch[1].trim().replace(/\s+/g, " ");
              break;
            }
            parent = parent.parentElement;
          }
        }

        // 価格を取得
        let minPrice = null;
        let parent = link.parentElement;
        for (let i = 0; i < 3 && parent; i++) {
          const priceMatches = parent.textContent.match(/([0-9,]+)\s*円/g);
          if (priceMatches) {
            const prices = priceMatches
              .map((p) => parseInt(p.replace(/[,円\s]/g, ""), 10))
              .filter((p) => p >= 5000 && p <= 100000);
            if (prices.length > 0) {
              minPrice = Math.min(...prices);
              break;
            }
          }
          parent = parent.parentElement;
        }

        lCodes.forEach((lCode) => {
          if (seen.has(lCode)) return;
          seen.add(lCode);
          results.push({
            passName: passName || `エクスプレス・パス（Lコード:${lCode}）`,
            lCode,
            minPrice,
          });
        });
      });

      return results;
    });
  } finally {
    await page.close();
  }
}

/**
 * GAS Web App にローチケデータをPOST
 */
async function postToGas(gasUrl, apiKey, items) {
  const body = JSON.stringify({
    action: "updateLawsonData",
    apiKey: apiKey,
    data: items,
  });

  const response = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body,
    redirect: "manual",
  });

  console.log(`  POST応答ステータス: ${response.status}`);
  if (response.status === 302 || response.status === 301) {
    const redirectUrl = response.headers.get("location");
    if (!redirectUrl) throw new Error("GAS APIリダイレクト先URLが取得できません");
    const response2 = await fetch(redirectUrl, { method: "GET", redirect: "follow" });
    const text = await response2.text();
    try { return JSON.parse(text); } catch { return { status: response2.ok ? "ok" : "error", rawResponse: text.substring(0, 200) }; }
  }

  const text = await response.text();
  try { return JSON.parse(text); } catch { return { status: response.ok ? "ok" : "error", rawResponse: text.substring(0, 200) }; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
