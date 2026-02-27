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

    // Step 2: 各Lコードの詳細ページから公演日程を取得
    console.log("Step 2: 各Lコードの公演日程を取得...\n");
    const performanceDates = {};
    for (const pass of passList) {
      // EP一覧ページで既に日付取得済みならスキップ
      if (pass.performanceFrom && pass.performanceTo) {
        performanceDates[pass.lCode] = { from: pass.performanceFrom, to: pass.performanceTo };
        console.log(`  ${pass.lCode}: ${pass.performanceFrom} 〜 ${pass.performanceTo} (一覧ページから取得)`);
        continue;
      }
      // 実際のリンクURLにPuppeteerでアクセス
      const dates = await scrapePerformanceDates(browser, pass.lCode, pass.href);
      if (dates) {
        performanceDates[pass.lCode] = dates;
        console.log(`  ${pass.lCode}: ${dates.from || "?"} 〜 ${dates.to || "?"}`);
      } else {
        console.log(`  ${pass.lCode}: 公演日程なし`);
      }
      await sleep(3000);
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

        // 公演日程を探す（リンク周辺のテキストから）
        let performanceFrom = "";
        let performanceTo = "";
        let searchParent = link.parentElement;
        for (let i = 0; i < 5 && searchParent; i++) {
          const parentText = searchParent.textContent || "";
          // "YYYY/MM/DD(曜) ～ YYYY/MM/DD(曜)" パターン
          const dateRange = parentText.match(
            /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*\([^)]*\)\s*[～〜~ー-]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/
          );
          if (dateRange) {
            performanceFrom = dateRange[1] + "-" + dateRange[2].padStart(2, "0") + "-" + dateRange[3].padStart(2, "0");
            performanceTo = dateRange[4] + "-" + dateRange[5].padStart(2, "0") + "-" + dateRange[6].padStart(2, "0");
            break;
          }
          // "YYYY年MM月DD日～YYYY年MM月DD日" パターン
          const jpRange = parentText.match(
            /(\d{4})年(\d{1,2})月(\d{1,2})日\s*[～〜~ー-]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/
          );
          if (jpRange) {
            performanceFrom = jpRange[1] + "-" + jpRange[2].padStart(2, "0") + "-" + jpRange[3].padStart(2, "0");
            performanceTo = jpRange[4] + "-" + jpRange[5].padStart(2, "0") + "-" + jpRange[6].padStart(2, "0");
            break;
          }
          searchParent = searchParent.parentElement;
        }

        // 実際のリンクURLを保存
        const fullHref = href.startsWith("http") ? href : (href.startsWith("/") ? "https://l-tike.com" + href : "");

        // 各Lコードを個別に登録
        lCodes.forEach((lCode) => {
          if (seen.has(lCode)) return;
          seen.add(lCode);
          results.push({
            passName: passName || `エクスプレス・パス（Lコード:${lCode}）`,
            lCode,
            minPrice,
            performanceFrom,
            performanceTo,
            href: fullHref,
          });
        });
      });

      return results;
    });

    // デバッグ: ページテキストのサンプルを出力（日付パターン調査用）
    const pageDebug = await page.evaluate(() => {
      const text = document.body.innerText || "";
      // 日付を含む行を抽出
      const lines = text.split("\n").filter(l => l.trim());
      const dateLines = lines.filter(l => /\d{4}[\/年]/.test(l)).slice(0, 10);
      // 各パスセクションの周辺テキスト（200文字サンプル）
      const passTexts = [];
      const sections = document.querySelectorAll('a[href*="lcd="]');
      sections.forEach((a, i) => {
        if (i >= 3) return;
        let parent = a.parentElement;
        for (let j = 0; j < 3 && parent; j++) parent = parent.parentElement;
        if (parent) passTexts.push(parent.textContent.trim().substring(0, 300));
      });
      return { dateLines, passTexts, totalLength: text.length };
    });
    console.log("\n  [デバッグ] ページテキスト長:", pageDebug.totalLength);
    if (pageDebug.dateLines.length > 0) {
      console.log("  [デバッグ] 日付を含む行:");
      pageDebug.dateLines.forEach(l => console.log("    " + l.substring(0, 150)));
    }
    if (pageDebug.passTexts.length > 0) {
      console.log("  [デバッグ] パスセクション周辺テキスト:");
      pageDebug.passTexts.forEach((t, i) => console.log(`    [${i}] ${t.substring(0, 200)}`));
    }

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
 * Lコードの詳細ページから公演日程を取得（Puppeteer版）
 * 各アクセスで新しいページを作成（stale page回避）
 * @param {Browser} browser
 * @param {string} lCode
 * @param {string} href - EP一覧ページから取得した実際のリンクURL
 * @return {Object|null} { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 */
async function scrapePerformanceDates(browser, lCode, href) {
  // 実際のリンクURLがあればそれを使う、なければ注文ページURLを試す
  const urls = [];
  if (href) urls.push(href);
  urls.push(`https://l-tike.com/order/?lcd=${lCode}`);

  for (const url of urls) {
    console.log(`  [試行] ${lCode}: ${url}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      let page = null;
      try {
        // 毎回新しいページを作成（stale page回避）
        page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        );
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await sleep(3000);

        const result = await page.evaluate(() => {
          const text = document.body.innerText || "";

          // パターン1: "YYYY/MM/DD(曜) ～ YYYY/MM/DD(曜)"
          const rangeMatch = text.match(
            /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*\([^)]*\)\s*[～〜~ー-]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/
          );
          if (rangeMatch) {
            return {
              from: rangeMatch[1] + "-" + rangeMatch[2].padStart(2, "0") + "-" + rangeMatch[3].padStart(2, "0"),
              to: rangeMatch[4] + "-" + rangeMatch[5].padStart(2, "0") + "-" + rangeMatch[6].padStart(2, "0"),
            };
          }

          // パターン2: "公演期間" 近くの日付
          const perfMatch = text.match(
            /公演[期間日]*[：:\s]*(\d{4})\/(\d{1,2})\/(\d{1,2})[^]*?[～〜~ー-]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/
          );
          if (perfMatch) {
            return {
              from: perfMatch[1] + "-" + perfMatch[2].padStart(2, "0") + "-" + perfMatch[3].padStart(2, "0"),
              to: perfMatch[4] + "-" + perfMatch[5].padStart(2, "0") + "-" + perfMatch[6].padStart(2, "0"),
            };
          }

          // パターン3: "YYYY年MM月DD日" 形式
          const jpMatch = text.match(
            /(\d{4})年(\d{1,2})月(\d{1,2})日\s*[～〜~ー-]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/
          );
          if (jpMatch) {
            return {
              from: jpMatch[1] + "-" + jpMatch[2].padStart(2, "0") + "-" + jpMatch[3].padStart(2, "0"),
              to: jpMatch[4] + "-" + jpMatch[5].padStart(2, "0") + "-" + jpMatch[6].padStart(2, "0"),
            };
          }

          // パターン4: JSON-LD
          const scripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (const script of scripts) {
            try {
              const json = JSON.parse(script.textContent);
              if (json.startDate && json.endDate) {
                return { from: json.startDate.substring(0, 10), to: json.endDate.substring(0, 10) };
              }
            } catch (e) { /* ignore */ }
          }

          // デバッグ: 日付を含むテキストを返す
          const dateLines = text.split("\n").filter(l => /\d{4}[\/年]/.test(l)).slice(0, 5);
          return { debug: dateLines.join(" | ").substring(0, 300) };
        });

        await page.close();

        if (result && result.from && result.to) {
          return result;
        }
        if (result && result.debug) {
          console.log(`  [デバッグ] ${lCode} 日付テキスト: ${result.debug || "(なし)"}`);
        }
        // 日付が見つからなかったら次のURLを試す
        break;
      } catch (err) {
        if (page) await page.close().catch(() => {});
        if (attempt === 0) {
          console.log(`  [リトライ] ${lCode}: ${err.message}`);
          await sleep(5000);
        } else {
          console.log(`  [エラー] ${lCode}: ${err.message}`);
        }
      }
    }
  }

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
