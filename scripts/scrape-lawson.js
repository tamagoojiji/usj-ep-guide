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
 * 2. 各Lコードの検索ページをスクレイプ（公演日、受付期間、販売状況）
 * 3. passIdマッピング（キーワードマッチ）
 * 4. GASへPOST送信
 */

const puppeteer = require("puppeteer");

// === 設定 ===
const EP_LIST_URL = "https://l-tike.com/leisure/usj/express_pass/";
const ORDER_URL_BASE = "https://l-tike.com/order/?gLcode=";
const WAIT_BETWEEN_REQUESTS_MS = 9000; // HTTP/2エラー回避

// === passId マッピング ===
// パス名キーワード → 既存passIdの対応表
const PASS_ID_MAPPING = [
  { keywords: ["プレミアム"], passId: "premium" },
  { keywords: ["トロッコ", "セレクション", "パス 7", "パス7"], passId: "ep7_trolley_selection" },
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
];

/**
 * パス名からpassIdを推定
 */
function matchPassId(passName) {
  const name = passName || "";
  for (const mapping of PASS_ID_MAPPING) {
    const allMatch = mapping.keywords.every((kw) => name.includes(kw));
    if (allMatch) return mapping.passId;
  }
  return null; // マッチなし → 予告パス（新規扱い）
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
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    // Step 1: EP一覧ページからパス情報を取得
    console.log("Step 1: EP一覧ページをスクレイプ...");
    const passList = await scrapeEpListPage(browser);
    console.log(`  ${passList.length}件のパスを検出\n`);

    if (passList.length === 0) {
      console.log("パスが見つかりませんでした。ページ構造を調査中...");
      // デバッグ: ページ内のリンクを調査
      const debugPage = await browser.newPage();
      try {
        await debugPage.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        );
        await debugPage.goto(EP_LIST_URL, { waitUntil: "networkidle0", timeout: 60000 });
        await sleep(5000);
        const debugInfo = await debugPage.evaluate(() => {
          const allLinks = Array.from(document.querySelectorAll("a")).slice(0, 50);
          return {
            title: document.title,
            linkCount: document.querySelectorAll("a").length,
            sampleLinks: allLinks.map((a) => ({
              href: a.getAttribute("href") || "",
              text: a.textContent.trim().substring(0, 60),
            })),
            bodySnippet: document.body.textContent.substring(0, 500),
          };
        });
        console.log("  ページタイトル:", debugInfo.title);
        console.log("  リンク総数:", debugInfo.linkCount);
        console.log("  本文冒頭:", debugInfo.bodySnippet);
        console.log("  リンクサンプル:");
        debugInfo.sampleLinks.forEach((l) => {
          if (l.href.includes("usj") || l.href.includes("express") || l.href.includes("Lcode") || l.href.includes("gLcode") || l.href.includes("lcd") || l.href.includes("order")) {
            console.log(`    [関連] ${l.text} → ${l.href}`);
          }
        });
      } finally {
        await debugPage.close();
      }
      process.exit(0);
    }

    // Step 2: 各Lコードの詳細ページをスクレイプ
    console.log("Step 2: 各パスの詳細情報を取得...\n");
    const detailedList = [];

    for (let i = 0; i < passList.length; i++) {
      const pass = passList[i];
      console.log(`  [${i + 1}/${passList.length}] ${pass.passName} (${pass.lCode})`);

      try {
        const detail = await scrapeSearchPage(browser, pass.lCode);
        const passId = matchPassId(pass.passName);

        detailedList.push({
          passId: passId || "",
          lCode: pass.lCode,
          passName: pass.passName,
          salesStatus: detail.salesStatus || "",
          salesFrom: detail.salesFrom || "",
          salesTo: detail.salesTo || "",
          performanceFrom: detail.performanceFrom || "",
          performanceTo: detail.performanceTo || "",
          minPrice: pass.minPrice || detail.minPrice || null,
        });

        console.log(`    状態: ${detail.salesStatus || "不明"} / 価格: ${pass.minPrice || "不明"} / passId: ${passId || "(新規)"}`);
      } catch (err) {
        console.error(`    エラー: ${err.message}`);
        // エラーでも一覧情報だけで登録
        detailedList.push({
          passId: matchPassId(pass.passName) || "",
          lCode: pass.lCode,
          passName: pass.passName,
          salesStatus: "",
          salesFrom: "",
          salesTo: "",
          performanceFrom: "",
          performanceTo: "",
          minPrice: pass.minPrice || null,
        });
      }

      // リクエスト間隔
      if (i < passList.length - 1) {
        await sleep(WAIT_BETWEEN_REQUESTS_MS);
      }
    }

    // Step 3: GASへPOST送信
    console.log(`\nStep 3: GASへデータ送信 (${detailedList.length}件)...`);
    const gasResult = await postToGas(GAS_URL, API_KEY, detailedList);
    console.log(`  GAS応答: ${JSON.stringify(gasResult)}`);

    // サマリー
    console.log("\n=== 結果サマリー ===");
    const mapped = detailedList.filter((d) => d.passId).length;
    const unmapped = detailedList.filter((d) => !d.passId).length;
    console.log(`合計: ${detailedList.length}件 (既存パス: ${mapped}, 予告パス: ${unmapped})`);

    detailedList.forEach((d) => {
      const status = d.salesStatus || "不明";
      const price = d.minPrice ? `¥${d.minPrice.toLocaleString()}~` : "価格未定";
      const id = d.passId || "(新規)";
      console.log(`  ${d.passName} [${status}] ${price} → ${id}`);
    });

  } finally {
    await browser.close();
  }
}

/**
 * EP一覧ページをスクレイプ
 * @return {Array<{passName, lCode, minPrice}>}
 */
async function scrapeEpListPage(browser) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.goto(EP_LIST_URL, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(5000);

    // ページからパス情報を抽出（gLcode= または lcd= リンクを検出）
    const passes = await page.evaluate(() => {
      const results = [];
      const links = document.querySelectorAll('a[href*="gLcode="], a[href*="lcd="]');
      const seen = new Set();

      links.forEach((link) => {
        const href = link.getAttribute("href") || "";
        // gLcode= または lcd= からLコードを抽出
        const lCodeMatch = href.match(/(?:gLcode|lcd)=(\d+)/);
        if (!lCodeMatch) return;

        const lCode = lCodeMatch[1];
        if (seen.has(lCode)) return;
        seen.add(lCode);

        // パス名を取得（リンク内テキストまたは親要素）
        let passName = link.textContent.trim();
        if (!passName || passName.length < 5) {
          const parent = link.closest("li, div, article, section");
          if (parent) {
            const heading = parent.querySelector("h2, h3, h4, .title, .name, strong");
            if (heading) passName = heading.textContent.trim();
          }
        }
        // さらにフォールバック: imgのalt属性
        if (!passName || passName.length < 5) {
          const img = link.querySelector("img");
          if (img && img.alt) passName = img.alt.trim();
        }

        // 価格を取得（リンクの近くにある価格表記）
        let minPrice = null;
        const parent = link.closest("li, div, article, section");
        if (parent) {
          const priceText = parent.textContent;
          const priceMatch = priceText.match(/([0-9,]+)\s*円/);
          if (priceMatch) {
            minPrice = parseInt(priceMatch[1].replace(/,/g, ""), 10);
          }
        }

        if (passName && passName.includes("エクスプレス")) {
          results.push({ passName, lCode, minPrice });
        }
      });

      return results;
    });

    return passes;
  } finally {
    await page.close();
  }
}

/**
 * Lコード検索ページをスクレイプして詳細情報を取得
 * @return {Object} { salesStatus, salesFrom, salesTo, performanceFrom, performanceTo, minPrice }
 */
async function scrapeSearchPage(browser, lCode, retryCount = 0) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    const url = ORDER_URL_BASE + lCode;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    if (response && response.status() >= 500 && retryCount < 3) {
      console.log(`    HTTP ${response.status()} → ${retryCount + 1}回目リトライ (10秒後)`);
      await sleep(10000);
      // finally で page.close() されるため、ここでは閉じない
      return scrapeSearchPage(browser, lCode, retryCount + 1);
    }

    await sleep(3000);

    // ページから詳細情報を抽出
    const detail = await page.evaluate(() => {
      const result = {
        salesStatus: "",
        salesFrom: "",
        salesTo: "",
        performanceFrom: "",
        performanceTo: "",
        minPrice: null,
      };

      const bodyText = document.body.textContent || "";

      // 販売状況の判定
      if (bodyText.includes("販売中") || bodyText.includes("好評販売中")) {
        result.salesStatus = "販売中";
      } else if (bodyText.includes("販売予定") || bodyText.includes("近日発売")) {
        result.salesStatus = "販売予定";
      } else if (bodyText.includes("受付終了") || bodyText.includes("販売終了")) {
        result.salesStatus = "受付終了";
      }

      // 受付期間（「受付期間」「販売期間」の近くの日付）
      const salesPeriodMatch = bodyText.match(/(?:受付|販売)期間[：:\s]*(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})日?\s*[〜～~―—-]\s*(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})日?/);
      if (salesPeriodMatch) {
        result.salesFrom = `${salesPeriodMatch[1]}-${salesPeriodMatch[2].padStart(2, "0")}-${salesPeriodMatch[3].padStart(2, "0")}`;
        result.salesTo = `${salesPeriodMatch[4]}-${salesPeriodMatch[5].padStart(2, "0")}-${salesPeriodMatch[6].padStart(2, "0")}`;
      }

      // 公演期間（「公演」「利用」の近くの日付）
      const perfPeriodMatch = bodyText.match(/(?:公演|利用|入場)期間[：:\s]*(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})日?\s*[〜～~―—-]\s*(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})日?/);
      if (perfPeriodMatch) {
        result.performanceFrom = `${perfPeriodMatch[1]}-${perfPeriodMatch[2].padStart(2, "0")}-${perfPeriodMatch[3].padStart(2, "0")}`;
        result.performanceTo = `${perfPeriodMatch[4]}-${perfPeriodMatch[5].padStart(2, "0")}-${perfPeriodMatch[6].padStart(2, "0")}`;
      }

      // 価格
      const priceMatches = bodyText.match(/([0-9,]+)\s*円/g);
      if (priceMatches) {
        const prices = priceMatches
          .map((p) => parseInt(p.replace(/[,円\s]/g, ""), 10))
          .filter((p) => p >= 5000 && p <= 100000);
        if (prices.length > 0) {
          result.minPrice = Math.min(...prices);
        }
      }

      return result;
    });

    return detail;
  } finally {
    await page.close();
  }
}

/**
 * GAS Web App にローチケデータをPOST
 * GASは302リダイレクトを返し、fetch()はPOST→GETに変換するため手動リダイレクト対応
 */
async function postToGas(gasUrl, apiKey, items) {
  const body = JSON.stringify({
    action: "updateLawsonData",
    apiKey: apiKey,
    data: items,
  });

  // 1回目: manual redirect でリダイレクトURLを取得
  const response = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body,
    redirect: "manual",
  });

  // リダイレクト(302)の場合、リダイレクト先に再度POST
  if (response.status === 302 || response.status === 301) {
    const redirectUrl = response.headers.get("location");
    if (!redirectUrl) {
      throw new Error("GAS APIリダイレクト先URLが取得できません");
    }
    const response2 = await fetch(redirectUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      redirect: "follow",
    });
    if (!response2.ok) {
      throw new Error(`GAS APIエラー: ${response2.status} ${response2.statusText}`);
    }
    return await response2.json();
  }

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
