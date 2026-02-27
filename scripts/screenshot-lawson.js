/**
 * ローチケ検索ページから公演日程を抽出
 * headless: false + 1URLずつ新ブラウザインスタンスで実行
 *
 * 使い方: node scripts/screenshot-lawson.js
 * 結果: 全Lコードの公演日程をJSON出力 + GASへ自動反映
 */
const puppeteer = require("puppeteer");

// Lコードグループ（一覧ページの各リンクに対応）
const LCD_GROUPS = [
  { lCodes: ["50028", "50015"], name: "EP7 トロッコ＆セレクション" },
  { lCodes: ["50029"], name: "EP4 レース＆トロッコ" },
  { lCodes: ["50030"], name: "EP4 アドベンチャー＆レース" },
  { lCodes: ["50031"], name: "EP4 ダイナソー＆4-D" },
  { lCodes: ["50027", "50016"], name: "EP4 4-D＆バックドロップ" },
  { lCodes: ["50018"], name: "EP4 ミニオン＆ハリウッド" },
  { lCodes: ["50017"], name: "EP4 レース＆シアター" },
];

async function main() {
  console.log("=== ローチケ 公演日程抽出 ===\n");

  const allResults = {};

  for (let gi = 0; gi < LCD_GROUPS.length; gi++) {
    const group = LCD_GROUPS[gi];
    const lcdParam = group.lCodes.join("%2C");
    const url = `https://l-tike.com/search/?lcd=${lcdParam}`;

    console.log(`[${gi + 1}/${LCD_GROUPS.length}] ${group.name}`);
    console.log(`  URL: ${url}`);

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

      await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 5000));

      // スクショ保存
      const ssPath = `/Users/yontsuhashikunihiko/Documents/lawson-${group.lCodes[0]}.png`;
      await page.screenshot({ path: ssPath, fullPage: true });

      // テキストから全日付ペアを抽出
      const result = await page.evaluate(() => {
        const text = document.body?.innerText || "";
        const entries = [];

        // 検索結果のブロックを分割（"Lコード" で区切る）
        const blocks = text.split(/Lコード[：:]?\s*(\d{5})/);

        // ページ全体からも抽出
        // パターン: "公演期間：2026/4/1(火) ～ 2026/4/30(水)" or "公演：2026/2/27(木) ～ 2026/3/31(月)"
        const periodRegex = /(?:公演[期日]?間?\s*[：:]?\s*)?(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[（(][^）)]+[）)]\s*[～〜]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/g;
        let match;
        while ((match = periodRegex.exec(text)) !== null) {
          const from = `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
          const to = `${match[4]}-${String(match[5]).padStart(2, "0")}-${String(match[6]).padStart(2, "0")}`;
          entries.push({ from, to });
        }

        // Lコード別のマッピングを試みる
        const lCodeMap = {};
        const lCodeSections = text.split(/(?=Lコード[：:]?\s*\d{5})/);
        for (const section of lCodeSections) {
          const lcMatch = section.match(/Lコード[：:]?\s*(\d{5})/);
          if (!lcMatch) continue;
          const lCode = lcMatch[1];
          const periodM = section.match(/(?:公演[期日]?間?\s*[：:]?\s*)?(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[（(][^）)]+[）)]\s*[～〜]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
          if (periodM) {
            lCodeMap[lCode] = {
              from: `${periodM[1]}-${String(periodM[2]).padStart(2, "0")}-${String(periodM[3]).padStart(2, "0")}`,
              to: `${periodM[4]}-${String(periodM[5]).padStart(2, "0")}-${String(periodM[6]).padStart(2, "0")}`,
            };
          }
          // 販売期間も抽出
          const salesM = section.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[（(][^）)]+[）)]\s*\d{1,2}:\d{2}\s*[～〜]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
          if (salesM && lCodeMap[lCode]) {
            lCodeMap[lCode].salesTo = `${salesM[4]}-${String(salesM[5]).padStart(2, "0")}-${String(salesM[6]).padStart(2, "0")}`;
          }
        }

        // 価格も抽出
        const priceMatches = text.match(/([0-9,]+)\s*円/g) || [];
        const prices = priceMatches
          .map((p) => parseInt(p.replace(/[,円\s]/g, ""), 10))
          .filter((p) => p >= 5000 && p <= 100000);

        return {
          allPeriods: entries,
          lCodeMap,
          minPrice: prices.length > 0 ? Math.min(...prices) : null,
          maxPrice: prices.length > 0 ? Math.max(...prices) : null,
        };
      });

      console.log(`  公演期間: ${JSON.stringify(result.allPeriods)}`);
      console.log(`  Lコード別: ${JSON.stringify(result.lCodeMap)}`);
      if (result.minPrice) {
        console.log(`  価格: ¥${result.minPrice}～¥${result.maxPrice}`);
      }

      // Lコード別の結果を保存
      if (Object.keys(result.lCodeMap).length > 0) {
        for (const [lc, dates] of Object.entries(result.lCodeMap)) {
          allResults[lc] = { ...dates, minPrice: result.minPrice };
        }
      } else if (result.allPeriods.length > 0) {
        // Lコード別に分離できない場合、全期間ペアを順番にLコードに割り当て
        for (let i = 0; i < group.lCodes.length && i < result.allPeriods.length; i++) {
          allResults[group.lCodes[i]] = {
            from: result.allPeriods[i].from,
            to: result.allPeriods[i].to,
            minPrice: result.minPrice,
          };
        }
      }

      await page.close();
    } catch (e) {
      console.log(`  エラー: ${e.message.substring(0, 100)}`);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }

    // 次のURLまで10秒待機
    if (gi < LCD_GROUPS.length - 1) {
      console.log("  10秒待機...\n");
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  // === 結果サマリー ===
  console.log("\n=== 全Lコード 公演日程サマリー ===\n");
  for (const [lc, data] of Object.entries(allResults)) {
    console.log(`  ${lc}: ${data.from} ～ ${data.to}${data.salesTo ? ` (販売～${data.salesTo})` : ""}${data.minPrice ? ` ¥${data.minPrice}~` : ""}`);
  }

  // === GASへ反映 ===
  const GAS_URL = process.env.GAS_WEB_APP_URL || process.env.GAS_ENDPOINT;
  const API_KEY = process.env.GAS_API_KEY || process.env.PRICE_UPDATE_API_KEY;

  if (GAS_URL && API_KEY && Object.keys(allResults).length > 0) {
    console.log("\n=== GASへ公演日程を反映 ===");
    const items = Object.entries(allResults).map(([lCode, data]) => ({
      lCode,
      passId: "",
      passName: "",
      salesStatus: "販売中",
      salesFrom: "",
      salesTo: data.salesTo || "",
      performanceFrom: data.from,
      performanceTo: data.to,
      minPrice: data.minPrice || null,
    }));

    try {
      const response = await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateLawsonData", apiKey: API_KEY, data: items }),
        redirect: "manual",
      });

      if (response.status === 302 || response.status === 301) {
        const redirectUrl = response.headers.get("location");
        const r2 = await fetch(redirectUrl, { redirect: "follow" });
        const text = await r2.text();
        console.log(`  GAS応答: ${text.substring(0, 200)}`);
      } else {
        const text = await response.text();
        console.log(`  GAS応答: ${text.substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`  GAS送信エラー: ${e.message}`);
    }
  } else if (Object.keys(allResults).length > 0) {
    console.log("\n※ GAS_WEB_APP_URL / GAS_API_KEY 未設定のためGASへの反映はスキップ");
    console.log("  手動でスプレッドシートに入力してください。");
  }

  console.log("\n完了");
}

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
