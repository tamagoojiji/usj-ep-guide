/**
 * 全Lコードの受付期間（salesTo）を取得
 */
const puppeteer = require("puppeteer");

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
  console.log("=== 受付期間（salesTo）取得 ===\n");
  const allResults = [];

  for (let gi = 0; gi < LCD_GROUPS.length; gi++) {
    const group = LCD_GROUPS[gi];
    const lcdParam = group.lCodes.join("%2C");
    const url = `https://l-tike.com/search/?lcd=${lcdParam}`;
    console.log(`[${gi + 1}/${LCD_GROUPS.length}] ${group.name}: ${url}`);

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-http2", "--window-size=1280,900"],
      });
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 5000));

      const result = await page.evaluate(() => {
        const text = document.body?.innerText || "";
        const entries = [];

        // 全日付ペア（公演日＋受付期間）を抽出
        // パターン1: 公演日 "2026/4/1(水) ～ 2026/4/30(木)"
        // パターン2: 受付期間 "2026/2/25(水) 12:00 ～ 2026/5/30(土) 22:00"
        const allDatePairs = [];
        const pairRegex = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[（(][^）)]+[）)]\s*(?:\d{1,2}:\d{2}\s*)?[～〜]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[（(][^）)]+[）)]\s*(?:\d{1,2}:\d{2})?/g;
        let m;
        while ((m = pairRegex.exec(text)) !== null) {
          allDatePairs.push({
            from: `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`,
            to: `${m[4]}-${String(m[5]).padStart(2, "0")}-${String(m[6]).padStart(2, "0")}`,
            raw: m[0].substring(0, 80),
          });
        }

        return allDatePairs;
      });

      console.log(`  日付ペア: ${result.length}件`);
      result.forEach((r) => console.log(`    ${r.from} ～ ${r.to}  (${r.raw})`));

      // 公演日と受付期間をペアリング（2つずつ: 公演日→受付期間）
      for (let i = 0; i < result.length; i += 2) {
        const perfPair = result[i];
        const salesPair = result[i + 1];
        const lCode = group.lCodes[Math.floor(i / 2)] || group.lCodes[0];
        allResults.push({
          lCode,
          name: group.name,
          performanceFrom: perfPair?.from || "",
          performanceTo: perfPair?.to || "",
          salesTo: salesPair?.to || "",
        });
      }

      await page.close();
    } catch (e) {
      console.log(`  エラー: ${e.message.substring(0, 100)}`);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }

    if (gi < LCD_GROUPS.length - 1) {
      console.log("  10秒待機...\n");
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  console.log("\n=== 結果 ===");
  console.log("const PERFORMANCE_DATES = {");
  for (const r of allResults) {
    console.log(`  "${r.lCode}": { from: "${r.performanceFrom}", to: "${r.performanceTo}", salesTo: "${r.salesTo}" },`);
  }
  console.log("};");
}

main().catch(console.error);
