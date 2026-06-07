// Diagnostic: does the CPU respond to RUN/PAUSE while ANTIC is live, and does
// switching the demo work? Samples live globals over time.
const { chromium } = require('playwright');
const path = require('path');

const snap = (page) => page.evaluate(() => ({
  pc: regs.PC, autoRun, halted, anticHalt, anticLive,
  cooldown: typeof anticCooldown !== 'undefined' ? anticCooldown : null,
  dma: !!anticDMA, frames: anticFrames, demo: currentDemoName,
}));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1420, height: 980 } });
  const logs = [];
  page.on('console', m => logs.push('[' + m.type() + '] ' + m.text()));
  page.on('pageerror', e => logs.push('[PAGEERROR] ' + e.message));

  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  console.log('idle  :', JSON.stringify(await snap(page)));
  await page.waitForTimeout(800);
  console.log('idle2 :', JSON.stringify(await snap(page)));

  await page.click('#run');
  const pcs = [];
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(300); pcs.push((await snap(page)).pc); }
  console.log('RUN pc samples:', pcs.join(' '));
  console.log('after run:', JSON.stringify(await snap(page)));

  await page.click('#pause');
  await page.waitForTimeout(400);
  const a = (await snap(page)).pc; await page.waitForTimeout(800); const b = (await snap(page)).pc;
  console.log('PAUSE pc:', a, '->', b, (a === b ? '(frozen=OK)' : '(still moving=BUG)'));

  await page.selectOption('#demo', '2');
  await page.waitForTimeout(300);
  console.log('after demo switch:', JSON.stringify(await snap(page)));

  console.log('errors:', logs.length ? logs.join('\n') : '(none)');
  await browser.close();
})();
