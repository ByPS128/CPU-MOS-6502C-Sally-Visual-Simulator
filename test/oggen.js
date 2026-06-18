// Generates the Open Graph cover image: the "Hello World (inverse blink)" demo
// captured at the moment ANTIC has painted the text INVERSELY on the TV.
// Output: og-cover.png in the repo root, cropped to Facebook's 1.91:1 ratio.
//   node test/oggen.js
const { chromium } = require('playwright');
const path = require('path');

// screen codes for "Hello World!" (internal codes, space=$00, '!'=$01)
const NORMAL = [0x28, 0x25, 0x2C, 0x2C, 0x2F, 0x00, 0x37, 0x2F, 0x32, 0x2C, 0x24, 0x01];
const INVERSE = NORMAL.map(c => c | 0x80);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({
    viewport: { width: 1740, height: 980 },
    deviceScaleFactor: 2,                 // crisp 2x output
  });
  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // Hello World (inverse blink), ANTIC on
  await page.evaluate(() => { const a = document.getElementById('antic'); if (!a.checked) { a.checked = true; anticLive = true; } });
  await page.selectOption('#demo', '6');
  await page.click('#reset');

  // Run in turbo to reach the blink loop fast (populates registers like a live run)
  await page.check('#turbo');
  await page.click('#run');
  for (let i = 0; i < 200; i++) {
    const v = await page.evaluate(() => mem[0x1000]);
    if (v === 0xA8) break;               // inverse reached -> we're in the flip loop
    await page.waitForTimeout(80);
  }
  await page.click('#pause');
  await page.uncheck('#turbo');

  // Force a clean, fully-inverse "Hello World!" (avoids catching a half-flipped frame)
  await page.evaluate((I) => { for (let i = 0; i < I.length; i++) mem[0x1000 + i] = I[i]; }, INVERSE);

  // Wait for ANTIC to paint the inverse text onto the TV
  for (let i = 0; i < 80; i++) {
    const tv = await page.evaluate(() => tvCells.slice(0, 12));
    if (JSON.stringify(tv) === JSON.stringify(INVERSE)) break;
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(200);

  const out = path.resolve(__dirname, '..', 'og-cover.png');
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1740, height: 911 } });
  console.log('wrote', out);
  await browser.close();
})();
