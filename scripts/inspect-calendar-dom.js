/**
 * USJカレンダーのDOM構造を調査するスクリプト（改良版）
 * 有効日・無効日のaria-labelと価格要素を詳しく調べる
 */
const puppeteer = require("puppeteer");

const TEST_URL = "https://store.usj.co.jp/ja/jp/c/expresspass/EXP0068?config=true";

async function main() {
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

  console.log("ページ遷移中...");
  await page.goto(TEST_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  const currentUrl = page.url();
  if (currentUrl.includes("queue")) {
    console.log("Queue-it 検出 — 30秒待機...");
    await new Promise((r) => setTimeout(r, 30000));
  }

  try {
    await page.waitForNetworkIdle({ idleTime: 2000, timeout: 20000 });
  } catch {}

  // 枚数セレクタクリック
  await page.evaluate(() => {
    const gdsQ = document.querySelector("gds-quantity");
    if (gdsQ) {
      const btn = gdsQ.querySelector("button.plus, button:last-child");
      if (btn && !btn.disabled) btn.click();
    }
  });
  await new Promise((r) => setTimeout(r, 3000));

  try {
    await page.waitForSelector("gds-calendar-day", { timeout: 30000 });
  } catch {
    console.log("カレンダー要素が見つかりません");
    await browser.close();
    return;
  }
  await new Promise((r) => setTimeout(r, 3000));

  // 詳細DOM調査
  const domInfo = await page.evaluate(() => {
    const days = document.querySelectorAll("gds-calendar-day");
    const enabledDays = [];
    const disabledDays = [];

    for (const day of days) {
      const dateAttr = day.getAttribute("data-date");
      const disabled = day.getAttribute("data-disabled") === "true";

      // ボタン要素のaria-label
      const btn = day.querySelector("button");
      const ariaLabel = btn ? btn.getAttribute("aria-label") : null;

      // 全テキストコンテンツ（深い子要素含む）
      const allText = (day.innerText || day.textContent || "").trim();

      // 価格要素を探す
      const priceElements = day.querySelectorAll(
        '[class*="price"], [class*="cost"], gds-eyebrow, gds-body'
      );
      const priceTexts = [];
      for (const pe of priceElements) {
        const t = (pe.innerText || pe.textContent || "").trim();
        if (t) priceTexts.push({ tag: pe.tagName, class: pe.className, text: t });
      }

      // innerHTML全文（1500文字まで）
      const html = day.innerHTML.substring(0, 1500);

      const entry = {
        date: dateAttr,
        disabled: disabled,
        ariaLabel: ariaLabel,
        allText: allText,
        priceTexts: priceTexts,
        innerHTML: html,
      };

      if (disabled) {
        disabledDays.push(entry);
      } else {
        enabledDays.push(entry);
      }
    }

    return {
      total: days.length,
      enabled: enabledDays.length,
      disabled: disabledDays.length,
      enabledSamples: enabledDays.slice(0, 5),
      disabledSamples: disabledDays.slice(0, 3),
    };
  });

  console.log(`\n=== カレンダー: 全${domInfo.total}日 / 有効${domInfo.enabled}日 / 無効${domInfo.disabled}日 ===`);

  console.log("\n--- 有効日（販売中）サンプル ---");
  for (const d of domInfo.enabledSamples) {
    console.log(`\ndate="${d.date}" aria-label="${d.ariaLabel}"`);
    console.log(`テキスト: "${d.allText}"`);
    console.log(`価格要素: ${JSON.stringify(d.priceTexts)}`);
    console.log(`innerHTML: ${d.innerHTML}`);
  }

  console.log("\n--- 無効日（売り切れ）サンプル ---");
  for (const d of domInfo.disabledSamples) {
    console.log(`\ndate="${d.date}" aria-label="${d.ariaLabel}"`);
    console.log(`テキスト: "${d.allText}"`);
    console.log(`価格要素: ${JSON.stringify(d.priceTexts)}`);
  }

  await browser.close();
  console.log("\n調査完了");
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});
