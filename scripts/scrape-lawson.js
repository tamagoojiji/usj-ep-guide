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
 * 2. 各Lコードの検索ページから公演日程を取得（ブラウザ内fetch）
 * 3. passIdマッピング（キーワードマッチ）
 * 4. GASへPOST送信
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
    const { passes: passList, page: listPage } = await scrapeEpListPage(browser);
    console.log(`  ${passList.length}件のパスを検出\n`);

    if (passList.length === 0) {
      console.log("パスが見つかりませんでした。");
      await listPage.close();
      process.exit(0);
    }

    // Step 2: 一覧ページのセクションテキストをデバッグ出力
    console.log("Step 2: 一覧ページのパスセクション構造を調査...\n");
    passList.forEach((pass) => {
      console.log(`--- ${pass.passName} (${pass.lCode}) ---`);
      console.log(`  価格: ${pass.minPrice || "なし"}`);
      if (pass.sectionText) {
        // 改行で分割して各行を出力（空行除去）
        const lines = pass.sectionText.split("\n").filter((l) => l.trim()).slice(0, 15);
        lines.forEach((line) => console.log(`  | ${line.trim()}`));
      }
      console.log();
    });

    // Step 3: 各Lコードの公演日程を取得（ブラウザ内fetch使用）
    console.log("Step 3: 各Lコードの公演日程を取得...");
    const dateMap = await scrapePerformanceDates(listPage, passList);
    await listPage.close();

    const datesFound = Object.keys(dateMap).length;
    console.log(`  ${datesFound}/${passList.length}件の公演日程を取得\n`);

    // Step 4: passIdマッピング + データ整形
    console.log("Step 4: passIdマッピング...\n");
    const dataList = passList.map((pass) => {
      const passId = matchPassId(pass.passName);
      const dates = dateMap[pass.lCode] || {};
      console.log(
        `  ${pass.passName} (${pass.lCode}) → ${passId || "(新規)"}` +
        (dates.performanceFrom ? ` [${dates.performanceFrom}～${dates.performanceTo}]` : " [日程未取得]")
      );
      return {
        passId: passId || "",
        lCode: pass.lCode,
        passName: pass.passName,
        salesStatus: "販売中",
        salesFrom: "",
        salesTo: "",
        performanceFrom: dates.performanceFrom || "",
        performanceTo: dates.performanceTo || "",
        minPrice: pass.minPrice || null,
      };
    });

    // Step 5: GASへPOST送信
    console.log(`\nStep 5: GASへデータ送信 (${dataList.length}件)...`);
    const gasResult = await postToGas(GAS_URL, API_KEY, dataList);
    console.log(`  GAS応答: ${JSON.stringify(gasResult)}`);

    // サマリー
    console.log("\n=== 結果サマリー ===");
    const mapped = dataList.filter((d) => d.passId).length;
    const unmapped = dataList.filter((d) => !d.passId).length;
    const withDates = dataList.filter((d) => d.performanceFrom).length;
    console.log(`合計: ${dataList.length}件 (既存パス: ${mapped}, 予告パス: ${unmapped}, 日程取得: ${withDates})`);
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
 * EP一覧ページをスクレイプ（ページは閉じずに返す — 後続のfetchで使用）
 * @return {{ passes: Array<{passName, lCode, minPrice}>, page: Page }}
 */
async function scrapeEpListPage(browser) {
  const page = await browser.newPage();
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

      // リンク周辺のHTML構造をデバッグ出力用に取得
      let sectionHtml = "";
      let sectionEl = link.parentElement;
      for (let i = 0; i < 5 && sectionEl; i++) {
        sectionEl = sectionEl.parentElement;
      }
      if (sectionEl) {
        sectionHtml = sectionEl.innerText.substring(0, 500);
      }

      // 各Lコードを個別に登録
      lCodes.forEach((lCode) => {
        if (seen.has(lCode)) return;
        seen.add(lCode);
        results.push({
          passName: passName || `エクスプレス・パス（Lコード:${lCode}）`,
          lCode,
          minPrice,
          sectionText: sectionHtml,
        });
      });
    });

    return results;
  });

  // ページを閉じずに返す（後続のfetchで使用するため）
  return { passes, page };
}

/**
 * 各Lコードの検索ページから公演日程を取得
 * ブラウザコンテキスト内のfetch()を使用し、Cookie/セッションを継承する
 * @param {Page} page - 一覧ページがロード済みのPuppeteerページ
 * @param {Array} passList - scrapeEpListPage の結果
 * @return {Object} lCode → { performanceFrom, performanceTo }
 */
async function scrapePerformanceDates(page, passList) {
  const dateMap = {};
  const uniqueLCodes = [...new Set(passList.map((p) => p.lCode))];

  console.log(`  ${uniqueLCodes.length}件のLコードを処理...\n`);

  for (const lCode of uniqueLCodes) {
    const searchUrl = `https://l-tike.com/search/?lcd=${lCode}`;
    console.log(`  [${lCode}] fetch: ${searchUrl}`);

    try {
      // ブラウザコンテキスト内でfetchを実行（Cookie/セッション継承）
      const result = await page.evaluate(async (url) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000);

          const res = await fetch(url, {
            signal: controller.signal,
            credentials: "include",
          });
          clearTimeout(timeoutId);

          const html = await res.text();

          // 公演日程の日付パターンを探す
          // パターン1: "2026/3/4(水)～2026/3/31(月)" 形式
          // パターン2: "2026年3月4日～2026年3月31日" 形式
          // パターン3: "2026/03/04～2026/03/31" 形式
          const datePatterns = [
            /(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})[日]?\s*(?:[（(][^）)]+[）)])?\s*～\s*(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})/,
            /公演[期日]間?\s*[：:]*\s*(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})[\s\S]*?～[\s\S]*?(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})/,
          ];

          let from = null;
          let to = null;
          for (const pattern of datePatterns) {
            const match = html.match(pattern);
            if (match) {
              from = `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
              to = `${match[4]}-${String(match[5]).padStart(2, "0")}-${String(match[6]).padStart(2, "0")}`;
              break;
            }
          }

          // デバッグ: HTMLの一部を返す（日付が見つからない場合）
          let debugSnippet = "";
          if (!from) {
            // 「公演」「期間」「日程」周辺のテキストを探す
            const contextMatch = html.match(/.{0,100}(公演|期間|日程|performance).{0,100}/i);
            debugSnippet = contextMatch ? contextMatch[0].replace(/<[^>]+>/g, " ").substring(0, 200) : "";
          }

          return { from, to, status: "ok", htmlLength: html.length, debugSnippet };
        } catch (e) {
          return {
            from: null,
            to: null,
            status: e.name === "AbortError" ? "timeout" : e.message,
            htmlLength: 0,
            debugSnippet: "",
          };
        }
      }, searchUrl);

      if (result.from && result.to) {
        console.log(`    → OK: ${result.from} ～ ${result.to} (${result.htmlLength}bytes)`);
        dateMap[lCode] = { performanceFrom: result.from, performanceTo: result.to };
      } else {
        console.log(`    → ${result.status} (${result.htmlLength}bytes)`);
        if (result.debugSnippet) {
          console.log(`    debug: ${result.debugSnippet}`);
        }
      }
    } catch (e) {
      console.log(`    → エラー: ${e.message}`);
    }

    // 各リクエスト間に3秒待機
    await sleep(3000);
  }

  // フォールバック: fetchで取得できなかったLコードに対してPuppeteerページ遷移を試行
  const missingLCodes = uniqueLCodes.filter((lc) => !dateMap[lc]);
  if (missingLCodes.length > 0) {
    console.log(`\n  フォールバック: ${missingLCodes.length}件をPuppeteerで再試行...`);
    for (const lCode of missingLCodes) {
      try {
        const dates = await scrapeSearchPageWithPuppeteer(page.browser(), lCode);
        if (dates) {
          console.log(`    [${lCode}] → OK: ${dates.performanceFrom} ～ ${dates.performanceTo}`);
          dateMap[lCode] = dates;
        } else {
          console.log(`    [${lCode}] → 日程取得失敗`);
        }
      } catch (e) {
        console.log(`    [${lCode}] → エラー: ${e.message}`);
      }
      await sleep(3000);
    }
  }

  return dateMap;
}

/**
 * Puppeteerで検索ページに直接遷移して日程を取得（フォールバック用）
 */
async function scrapeSearchPageWithPuppeteer(browser, lCode) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    await page.goto(`https://l-tike.com/search/?lcd=${lCode}`, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    await sleep(5000);

    const result = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : "";
      // 日付パターンを探す
      const match = text.match(/(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})[日]?\s*(?:[（(][^）)]+[）)])?\s*～\s*(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})/);
      if (match) {
        return {
          from: `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`,
          to: `${match[4]}-${String(match[5]).padStart(2, "0")}-${String(match[6]).padStart(2, "0")}`,
        };
      }
      return null;
    });

    if (result) {
      return { performanceFrom: result.from, performanceTo: result.to };
    }
    return null;
  } catch (e) {
    console.log(`    [${lCode}] Puppeteer: ${e.message.substring(0, 80)}`);
    return null;
  } finally {
    await page.close();
  }
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
