// Node-side logic tests for the p5-independent core (assembler + cpu).
const fs = require('fs');
const path = require('path');

let src = '';
for (const f of ['util.js', 'opcodes.js', 'program.js', 'assembler.js', 'cpu.js']) {
  src += fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8') + '\n';
}
// expose what we need from the eval scope
src += '\nmodule.exports = { assemble, execute, run, DEMOS };\n';
src += `
function run(prog, setup) {
  mem = new Uint8Array(65536);
  regs = { A:0, X:0, Y:0, SP:0xFF, P:FU|FI, PC:0x0600, IR:0 };
  lastMemAddr = -1;
  asm = assemble(prog, mem);
  if (setup) setup(mem);
  regs.PC = asm.origin;
  let g = 0, h = false;
  while (!h && g++ < 5000) { const r = execute(); for (const st of r.steps) st.apply(); h = r.halt; }
  return { A: regs.A, X: regs.X, P: regs.P, IR: regs.IR, entry: asm.origin, mem: mem, FC };
}
`;
const mod = {};
const fn = new Function('module', 'exports', 'require', src);
fn(mod, mod.exports = {}, require);
const { run } = mod.exports;

function prog(lines) {
  return '        *=$0600\n' + lines.map(l => '        ' + l).join('\n') + '\n        BRK\n';
}

let allPass = true;
function check(name, got, exp) {
  const ok = got === exp;
  if (!ok) allPass = false;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name +
    '  expected $' + exp.toString(16) + ' got $' + got.toString(16));
}

// --- BCD decimal-mode reference cases ---
check('ADC 09+01 dec',     run(prog(['SED','CLC','LDA #$09','ADC #$01'])).A, 0x10);
check('ADC 50+50 dec',     run(prog(['SED','CLC','LDA #$50','ADC #$50'])).A, 0x00);
check('ADC 99+99+1 dec',   run(prog(['SED','SEC','LDA #$99','ADC #$99'])).A, 0x99);
check('SBC 10-01 dec',     run(prog(['SED','SEC','LDA #$10','SBC #$01'])).A, 0x09);
check('SBC 00-01 dec',     run(prog(['SED','SEC','LDA #$00','SBC #$01'])).A, 0x99);
check('SBC 50-25 dec',     run(prog(['SED','SEC','LDA #$50','SBC #$25'])).A, 0x25);

// --- binary ADC/SBC still correct ---
check('ADC 7F+01 bin (V)', run(prog(['CLC','LDA #$7F','ADC #$01'])).A, 0x80);
check('SBC 05-03 bin',     run(prog(['SEC','LDA #$05','SBC #$03'])).A, 0x02);

// --- multi-origin entry point ---
const r2 = run('        *=$0600\n        LDA #$01\n        BRK\n        *=$0710\n        BRK\n');
check('entry with 2nd *=', r2.entry, 0x0600);

// --- indexed addressing (abs,X / abs,Y) + .byte directive ---
const ix = run(prog(['LDX #$02', 'LDA #$AB', 'STA $0710,X']));
check('STA abs,X target', ix.mem[0x0712], 0xAB);
const ixl = run('        *=$0600\n        LDX #$03\n        LDA data,X\n        STA $0710\n        BRK\n        *=$0750\ndata    .byte $11,$22,$33,$44,$55\n');
check('LDA abs,X from .byte', ixl.mem[0x0710], 0x44);

// --- every shipped demo: assembles, runs, and matches expected results ---
const DEMOS = mod.exports.DEMOS;
// 0: Hello World (ANTIC text) — copies internal codes into screen memory $1000
const hw = run(DEMOS[0].src);
const HELLO = [0x28, 0x25, 0x2C, 0x2C, 0x2F, 0x00, 0x37, 0x2F, 0x32, 0x2C, 0x24];
check('HELLO copied to $1000', JSON.stringify(Array.from(hw.mem.slice(0x1000, 0x100B))) === JSON.stringify(HELLO) ? 1 : 0, 1);
const d1 = run(DEMOS[1].src); check('Running total A', d1.A, 0x0F); check('Running total X', d1.X, 0x00); check('Running total mem', d1.mem[0x0710], 0x0F);
const d2 = run(DEMOS[2].src); check('16-bit lo', d2.mem[0x0710], 0x00); check('16-bit hi', d2.mem[0x0711], 0x02);
const d3 = run(DEMOS[3].src); check('BCD mem', d3.mem[0x0710], 0x07);
const d4 = run(DEMOS[4].src); check('Compare X', d4.X, 0x04); check('Compare mem', d4.mem[0x0710], 0x04);
const d5 = run(DEMOS[5].src); check('GTIA $D01A', d5.mem[0xD01A], 0x0E); check('POKEY $D200', d5.mem[0xD200], 0xA0); check('PIA $D301', d5.mem[0xD301], 0x3C);

// --- indirect indexed (zp),Y + equates + label arithmetic ---
const iy = run('ptr = $80\n        *=$0600\n        LDA #$00\n        STA ptr\n        LDA #$20\n        STA ptr+1\n        LDY #$05\n        LDA #$AB\n        STA (ptr),Y\n        BRK\n');
check('STA (zp),Y target', iy.mem[0x2005], 0xAB);

// --- .byte "string" -> Atari screen codes (H=$28 uppercase, i=$69 lowercase) ---
const sb = run('        *=$0600\n        BRK\n        *=$0700\nt       .byte "Hi"\n');
check('.byte string H', sb.mem[0x0700], 0x28);
check('.byte string i', sb.mem[0x0701], 0x69);

// EOR #$80 toggles the inverse-video bit
const eo = run(prog(['LDA #$28', 'EOR #$80', 'STA $0710']));
check('EOR #$80 inverse', eo.mem[0x0710], 0xA8);

// 6: Hello World (inverse blink) — writes via SAVMSC ptr, then blinks (XOR $80)
const port = run(DEMOS[6].src, (m) => { m[0x58] = 0x00; m[0x59] = 0x10; });  // OS sets SAVMSC -> $1000
const HW = [0x28, 0x65, 0x6C, 0x6C, 0x6F, 0x00, 0x37, 0x6F, 0x72, 0x6C, 0x64, 0x01]; // "Hello World!"
const portOk = HW.every((b, i) => { const v = port.mem[0x1000 + i]; return v === b || v === (b ^ 0x80); });
check('blink demo text @ $1000 (normal or inverse)', portOk ? 1 : 0, 1);

console.log(allPass ? '\nALL LOGIC TESTS PASS' : '\nLOGIC TEST FAILURES');
process.exit(allPass ? 0 : 1);
