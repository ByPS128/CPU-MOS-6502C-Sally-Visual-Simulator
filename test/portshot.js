const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1740, height: 980 } });
  await p.goto('file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.selectOption('#demo', '6');
  await p.fill('#speed', '30');
  await p.click('#run');
  const WANT = [0x28, 0x65, 0x6C, 0x6C, 0x6F, 0x00, 0x37, 0x6F, 0x72, 0x6C, 0x64, 0x01];
  for (let i = 0; i < 400; i++) {
    const row = await p.evaluate(() => Array.from(tvCells.slice(0, 12)));
    if (JSON.stringify(row) === JSON.stringify(WANT)) break;
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(__dirname, 'shot-port-tv.png'), clip: { x: 820, y: 470, width: 470, height: 330 } });
  console.log('tv row0:', JSON.stringify(await p.evaluate(() => Array.from(tvCells.slice(0, 12)))));
  await b.close();
})();
