// Headless verification: errors, ANTIC text mode (font render + speed), IR latch,
// final state, chip decoding.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1420, height: 980 } });
  const logs = [];
  page.on('console', m => logs.push('[' + m.type() + '] ' + m.text()));
  page.on('pageerror', e => logs.push('[PAGEERROR] ' + e.message));

  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, 'shot-initial.png') });

  // --- ANTIC respects the speed slider ---
  await page.fill('#speed', '2');  const slow = await page.evaluate(() => anticDMAFrames());
  await page.fill('#speed', '30'); const fast = await page.evaluate(() => anticDMAFrames());
  const speedOk = slow > fast;

  // --- ANTIC render path: inject HELLO into screen memory; ANTIC must paint it ---
  await page.selectOption('#demo', '0');     // Hello World (ANTIC text)
  await page.fill('#speed', '30');
  const HELLO = [0x28, 0x25, 0x2C, 0x2C, 0x2F, 0x00, 0x37, 0x2F, 0x32, 0x2C, 0x24];
  await page.evaluate((H) => { for (let i = 0; i < H.length; i++) mem[0x1000 + i] = H[i]; }, HELLO);
  let tv = null;
  for (let i = 0; i < 80; i++) {
    tv = await page.evaluate(() => tvCells.slice(0, 11));
    if (JSON.stringify(tv) === JSON.stringify(HELLO)) break;
    await page.waitForTimeout(120);
  }
  const renderOk = JSON.stringify(tv) === JSON.stringify(HELLO);
  await page.screenshot({ path: path.join(__dirname, 'shot-hello.png') });

  // --- CPU -> ANTIC integration: run demo; first letter 'H' must reach screen + TV ---
  await page.click('#reset');                // clears screen, re-lays the Display List
  await page.fill('#speed', '30');
  await page.click('#run');
  let integ = null, maxPC = 0x0600, shot = false;
  for (let i = 0; i < 150; i++) {
    integ = await page.evaluate(() => ({ pc: regs.PC, scr0: mem[0x1000], tv0: tvCells[0], dma: !!anticDMA, frames: anticFrames }));
    if (integ.pc > maxPC) maxPC = integ.pc;
    if (integ.dma && !shot) { await page.screenshot({ path: path.join(__dirname, 'shot-antic.png') }); shot = true; }
    if (integ.scr0 === 0x28 && integ.tv0 === 0x28) break;   // 'H' written by CPU and painted by ANTIC
    await page.waitForTimeout(120);
  }
  const integOk = integ && integ.scr0 === 0x28 && integ.tv0 === 0x28 && maxPC > 0x0600 && integ.frames >= 1;
  const anticOk = renderOk && integOk;
  await page.click('#pause');

  // --- deterministic CPU checks with ANTIC off ---
  await page.uncheck('#antic');
  await page.selectOption('#demo', '1');     // Running total (LDA #$00 = $A9)
  await page.fill('#speed', '30');
  await page.click('#step');
  await page.waitForTimeout(2200);
  const ir = await page.evaluate(() => ({ IR: regs.IR, PC: regs.PC, memPC: mem[regs.PC], A: regs.A }));
  const irOk = ir.IR === 0xA9 && ir.PC === 0x0602 && ir.memPC === 0xA2 && ir.A === 0x00;

  await page.click('#run');
  let fs = null;
  for (let i = 0; i < 200; i++) {
    fs = await page.evaluate(() => ({ A: regs.A, X: regs.X, mem710: mem[0x0710], halted }));
    if (fs.halted) break;
    await page.waitForTimeout(250);
  }
  const finalOk = fs && fs.halted && fs.A === 0x0F && fs.X === 0x00 && fs.mem710 === 0x0F;

  // --- hardware-poke chip decoding (demo 5) ---
  await page.selectOption('#demo', '5');
  await page.fill('#speed', '30');
  await page.click('#run');
  let chipSeen = null, ps = null;
  for (let i = 0; i < 160; i++) {
    const s = await page.evaluate(() => ({ dev: activeDevice, halted, gtia: mem[0xD01A], pokey: mem[0xD200] }));
    if (s.dev && s.dev !== 'RAM') chipSeen = s.dev;
    ps = s; if (s.halted) break;
    await page.waitForTimeout(120);
  }
  const pokeOk = ps && ps.halted && ps.gtia === 0x0E && ps.pokey === 0xA0 && chipSeen && chipSeen !== 'RAM';

  console.log('speed resp :', speedOk ? 'PASS' : 'FAIL', '(slow=' + slow + ' fast=' + fast + ')');
  console.log('ANTIC text :', anticOk ? 'PASS' : 'FAIL', 'render=' + renderOk + ' integration=' + integOk);
  console.log('IR latch   :', irOk ? 'PASS' : 'FAIL', JSON.stringify(ir));
  console.log('final state:', finalOk ? 'PASS' : 'FAIL', JSON.stringify(fs));
  console.log('chip decode:', pokeOk ? 'PASS' : 'FAIL', 'chipSeen=' + chipSeen, JSON.stringify(ps));
  console.log('console errors:', logs.length ? logs.join('\n') : '(none)');
  process.exit(speedOk && anticOk && irOk && finalOk && pokeOk && logs.length === 0 ? 0 : 1);
})();
