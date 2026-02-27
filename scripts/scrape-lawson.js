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
 * 2. passIdマッピング（キーワードマッチ）
 * 3. GASへPOST送信
 */

const puppeteer = require("puppeteer");

// === 設定 ===
const EP_LIST_URL = "https://l-tike.com/leisure/usj/express_pass/";

// === passId マッピング ===
// パス名キーワード → 既存passIdの対応表
const PASS_ID_MAPPING = [
  { keywords: ["プレミアム"], passId: "premium" },
  { keywords: ["バラエティ・スタンダード"], passId: "ep7_trolley_selection" },
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

/**
 * パス名からpassIdを推定
 */
function matchPassId(passName) {
  const name = passName || "";
  for (const mapping of PASS_ID_MAPPING) {
    const allMatch = mapping.keywords.every((kw) => name.includes(kw));
    if (allMatch) return mapping.passId;
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
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-http2",
    ],
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

    // Step 2: 各Lコードの検索ページから公演日程を取得
    console.log("Step 2: 各Lコードの公演日程を取得...\n");
    const performanceDates = {};
    for (const pass of passList) {
      const dates = await scrapePerformanceDates(browser, pass.lCode);
      if (dates) {
        performanceDates[pass.lCode] = dates;
        console.log(`  ${pass.lCode}: ${dates.from || "?"} 〜 ${dates.to || "?"}`);
      } else {
        console.log(`  ${pass.lCode}: 公演日程なし`);
      }
      await sleep(8000);
    }

    // Step 3: passIdマッピング + データ整形
    console.log("\nStep 3: passIdマッピング...\n");
    const dataList = passList.map((pass) => {
      const passId = matchPassId(pass.passName);
      const dates = performanceDates[pass.lCode] || {};
      console.log(`  ${pass.passName} (${pass.lCode}) → ${passId || "(新規)"}`);
      return {
        passId: passId || "",
        lCode: pass.lCode,
        passName: pass.passName,
        salesStatus: "販売中", // EP一覧ページに掲載 = 販売中
        salesFrom: "",
        salesTo: "",
        performanceFrom: dates.from || "",
        performanceTo: dates.to || "",
        minPrice: pass.minPrice || null,
      };
    });

    // Step 4: GASへPOST送信
    console.log(`\nStep 4: GASへデータ送信 (${dataList.length}件)...`);
    const gasResult = await postToGas(GAS_URL, API_KEY, dataList);
    console.log(`  GAS応答: ${JSON.stringify(gasResult)}`);

    // サマリー
    console.log("\n=== 結果サマリー ===");
    const mapped = dataList.filter((d) => d.passId).length;
    const unmapped = dataList.filter((d) => !d.passId).length;
    console.log(`合計: ${dataList.length}件 (既存パス: ${mapped}, 予告パス: ${unmapped})`);
    dataList.forEach((d) => {
      const price = d.minPrice ? `¥${d.minPrice.toLocaleString()}~` : "価格未定";
      const id = d.passId || "(新規)";
      console.log(`  ${d.passName} [${d.salesStatus}] ${price} → ${id}`);
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
    await page.goto(EP_LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(8000);

    const passes = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      // lcd= を含むリンクを全て取得
      const links = document.querySelectorAll('a[href*="lcd="]');

      links.forEach((link) => {
        const href = link.getAttribute("href") || "";
        const lcdParam = href.match(/lcd=([^&]+)/i);
        if (!lcdParam) return;

        // カンマ区切りのLコードを分割
        const lCodes = decodeURIComponent(lcdParam[1]).split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
        if (lCodes.length === 0) return;

        // パス名: リンクの前にあるテキストから「パス X ～XXX～」パターンを取得
        let passName = "";

        // 方法1: リンクの直前の兄弟要素からパス名を探す
        let prevEl = link.previousElementSibling;
        for (let i = 0; i < 10 && prevEl; i++) {
          const text = prevEl.textContent || "";
          // 「パス 4 ～XXX～」または「パス 7 ～XXX～」パターン
          const nameMatch = text.match(/(ユニバーサル・エクスプレス・パス\s*\d+\s*～[^～]+～)/);
          if (nameMatch) {
            passName = nameMatch[1].trim().replace(/\s+/g, " ");
            break;
          }
          prevEl = prevEl.previousElementSibling;
        }

        // 方法2: 親要素のテキストから探す（より狭い範囲）
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

        // 方法3: リンクテキストからLコード部分を除去
        if (!passName) {
          const linkText = link.textContent.trim();
          if (linkText.includes("エクスプレス")) {
            passName = linkText.replace(/Lコード[：:][^チ]+チケット購入ページへ進む/g, "").trim();
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

        // 各Lコードを個別に登録
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

    // デバッグ: 検出内容を出力
    if (passes.length === 0) {
      const debugInfo = await page.evaluate(() => {
        const allLinks = Array.from(document.querySelectorAll("a"));
        return {
          title: document.title,
          linkCount: allLinks.length,
          relatedLinks: allLinks.map((a) => ({
            href: a.getAttribute("href") || "",
            text: a.textContent.trim().substring(0, 100),
          })).filter((l) => l.href.includes("lcd") || l.href.includes("order") || l.text.includes("エクスプレス") || l.text.includes("Lコード")),
        };
      });
      console.log("  [デバッグ] ページタイトル:", debugInfo.title);
      console.log("  [デバッグ] リンク総数:", debugInfo.linkCount);
      console.log("  [デバッグ] 関連リンク:");
      debugInfo.relatedLinks.forEach((l) => {
        console.log(`    ${l.text} → ${l.href}`);
      });
    }

    return passes;
  } finally {
    await page.close();
  }
}

/**
 * Lコードの検索ページから公演日程を取得
 * @param {Browser} browser
 * @param {string} lCode
 * @return {Object|null} { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 */
async function scrapePerformanceDates(browser, lCode) {
  const url = `https://l-tike.com/search/?lcd=${lCode}`;
  const page = await browser.newPage();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      );
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(5000);

      const dates = await page.evaluate(() => {
        // ページ全体のテキストから公演日程パターンを探す
        const text = document.body.innerText || "";

        // パターン1: "YYYY/MM/DD(曜) ～ YYYY/MM/DD(曜)" or "YYYY/M/D(曜)〜YYYY/M/D(曜)"
        const rangeMatch = text.match(
          /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*\([^)]*\)\s*[～〜~ー-]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/
        );
        if (rangeMatch) {
          const from = `${rangeMatch[1]}-${rangeMatch[2].padStart(2, "0")}-${rangeMatch[3].padStart(2, "0")}`;
          const to = `${rangeMatch[4]}-${rangeMatch[5].padStart(2, "0")}-${rangeMatch[6].padStart(2, "0")}`;
          return { from, to };
        }

        // パターン2: "公演期間" の近くの日付
        const perfMatch = text.match(
          /公演[期間日]*[：:\s]*(\d{4})\/(\d{1,2})\/(\d{1,2})[^]*?[～〜~ー-]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/
        );
        if (perfMatch) {
          const from = `${perfMatch[1]}-${perfMatch[2].padStart(2, "0")}-${perfMatch[3].padStart(2, "0")}`;
          const to = `${perfMatch[4]}-${perfMatch[5].padStart(2, "0")}-${perfMatch[6].padStart(2, "0")}`;
          return { from, to };
        }

        // パターン3: meta tagやJSON-LDから探す
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
          try {
            const json = JSON.parse(script.textContent);
            if (json.startDate && json.endDate) {
              return {
                from: json.startDate.substring(0, 10),
                to: json.endDate.substring(0, 10),
              };
            }
          } catch (e) { /* ignore */ }
        }

        return null;
      });

      await page.close();
      return dates;
    } catch (err) {
      if (attempt === 0) {
        console.log(`  [リトライ] ${lCode}: ${err.message}`);
        await sleep(5000);
      } else {
        console.log(`  [エラー] ${lCode}: ${err.message}`);
        await page.close();
        return null;
      }
    }
  }

  await page.close();
  return null;
}

/**
 * GAS Web App にローチケデータをPOST
 * GASは302リダイレクトを返す。
 * 1. POST(redirect:manual) → doPost()実行 → 302レスポンス
 * 2. GET(redirect:follow) → リダイレクト先からdoPost()の結果を取得
 */
async function postToGas(gasUrl, apiKey, items) {
  const body = JSON.stringify({
    action: "updateLawsonData",
    apiKey: apiKey,
    data: items,
  });

  // Step 1: POSTでデータ送信（doPost実行）→ 302リダイレクト取得
  const response = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body,
    redirect: "manual",
  });

  // Step 2: リダイレクト先をGETで取得（doPostの実行結果）
  console.log(`  POST応答ステータス: ${response.status}`);
  if (response.status === 302 || response.status === 301) {
    const redirectUrl = response.headers.get("location");
    console.log(`  リダイレクト先: ${redirectUrl ? redirectUrl.substring(0, 100) : "なし"}`);
    if (!redirectUrl) {
      throw new Error("GAS APIリダイレクト先URLが取得できません");
    }
    const response2 = await fetch(redirectUrl, {
      method: "GET",
      redirect: "follow",
    });
    const text = await response2.text();
    try {
      return JSON.parse(text);
    } catch {
      console.log(`  GAS応答(raw): ${text.substring(0, 200)}`);
      return { status: response2.ok ? "ok" : "error", rawResponse: text.substring(0, 200) };
    }
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.log(`  GAS応答(raw): ${text.substring(0, 200)}`);
    return { status: response.ok ? "ok" : "error", rawResponse: text.substring(0, 200) };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 実行
main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
