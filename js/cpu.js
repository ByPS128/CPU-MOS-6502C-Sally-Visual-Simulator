// --- 6502C "Sally" CPU state + a bus-aware, step-by-step interpreter ----------
// execute() runs ONE instruction and returns a list of "micro-steps". Each step
// is a single transfer the animated dot performs along the schematic:
//
//   bus: 'addr'      -> travels the ADDRESS bus (CPU -> memory),   value = $hhhh
//        'data'      -> travels the DATA bus (memory <-> register), value = $hh
//        'internal'  -> travels inside the CPU (register <-> ALU),  value = $hh
//        'none'      -> a control note, no dot travels
//
// apply() commits the state change at the exact moment the dot arrives, so the
// displayed registers / RAM change in lock-step with the animation.

const FC = 0x01, FZ = 0x02, FI = 0x04, FD = 0x08, FB = 0x10, FU = 0x20, FV = 0x40, FN = 0x80;

let mem = new Uint8Array(65536);
let regs = { A: 0, X: 0, Y: 0, SP: 0xFF, P: FU | FI, PC: 0x0600, IR: 0 };
let asm = null;            // assembler output (lines, addrToLine, ...)
let lastMemAddr = -1;      // last RAM cell touched (for highlight + RAM window)

function cpuReset() {
  mem = new Uint8Array(65536);
  regs = { A: 0, X: 0, Y: 0, SP: 0xFF, P: FU | FI, PC: 0x0600, IR: 0 };
  lastMemAddr = -1;
  asm = assemble(currentDemoSrc, mem);
  regs.PC = asm.origin;
}

function step(from, to, value, desc, apply, fmt, bus, at) {
  return { from, to, value, desc, apply: apply || (() => {}), fmt: fmt || 'hex2', bus: bus || 'internal', at };
}
// A control note: no dot travels, just hold the description for a beat.
function note(desc, apply) { return step('CTRL', 'CTRL', null, desc, apply, 'none', 'none'); }

function setNZ(p, v) {
  p &= ~(FZ | FN);
  if ((v & 0xff) === 0) p |= FZ;
  if (v & 0x80) p |= FN;
  return p;
}
function flagSet(mask) { return (regs.P & mask) !== 0; }

function modeText(mode, operand, addr, zp) {
  if (mode === 'imm') return '#$' + hex2(operand);
  if (mode === 'zp')  return '$' + hex2(addr);
  if (mode === 'abs') return '$' + hex4(addr);
  if (mode === 'absx') return '$' + hex4(addr) + ',X';
  if (mode === 'absy') return '$' + hex4(addr) + ',Y';
  if (mode === 'indy') return '($' + hex2(zp) + '),Y';
  if (mode === 'rel') return '$' + hex4(addr);
  return '';
}

// Execute the instruction at regs.PC. Returns {steps, halt}.
function execute() {
  const steps = [];
  const pc = regs.PC;
  const opcode = mem[pc];
  const info = OPDECODE[opcode];

  // ---- fetch the opcode over the bus (address out, opcode back) ----
  steps.push(step('PC', 'MEM', pc, 'Fetch: PC ($' + hex4(pc) + ') → address bus',
    () => { lastMemAddr = pc; }, 'hex4', 'addr', pc));

  if (!info || info.mnemonic === 'BRK') {
    steps.push(step('MEM', 'IR', opcode, 'Read opcode $' + hex2(opcode) + ' = BRK',
      () => { regs.IR = opcode; }, 'hex2', 'data', pc));
    steps.push(note('BRK — software interrupt / halt', () => {}));
    return { steps, halt: true };
  }

  const { mnemonic, mode, len } = info;
  const fall = (pc + len) & 0xffff;

  // decode operand / effective address
  let operand = null, addr = null, ea = null;
  if (mode === 'imm') { ea = (pc + 1) & 0xffff; operand = mem[ea]; }
  else if (mode === 'zp') { addr = mem[(pc + 1) & 0xffff]; ea = addr; operand = mem[ea]; }
  else if (mode === 'abs') { addr = mem[(pc + 1) & 0xffff] | (mem[(pc + 2) & 0xffff] << 8); ea = addr; operand = mem[ea]; }
  else if (mode === 'absx' || mode === 'absy') {
    addr = mem[(pc + 1) & 0xffff] | (mem[(pc + 2) & 0xffff] << 8);      // base
    ea = (addr + (mode === 'absx' ? regs.X : regs.Y)) & 0xffff;          // effective = base + index
    operand = mem[ea];
  }
  else if (mode === 'indy') {                                            // (zp),Y indirect indexed
    const zp = mem[(pc + 1) & 0xffff];
    addr = mem[zp] | (mem[(zp + 1) & 0xff] << 8);                        // 16-bit pointer from zero page
    ea = (addr + regs.Y) & 0xffff;                                       // + Y = effective address
    operand = mem[ea];
  }
  else if (mode === 'rel') { const o = mem[(pc + 1) & 0xffff]; addr = (fall + (o < 0x80 ? o : o - 256)) & 0xffff; }

  steps.push(step('MEM', 'IR', opcode,
    'Read opcode $' + hex2(opcode) + ' = ' + mnemonic + ' ' + modeText(mode, operand, addr, mem[(pc + 1) & 0xffff]),
    () => { regs.PC = fall; regs.IR = opcode; }, 'hex2', 'data', pc));

  // helpers ------------------------------------------------------------------
  // addrOut remembers the effective address so the following data step routes
  // to the correct memory-mapped device (RAM vs an Atari chip).
  let curEA = pc;
  const addrOut = (a, src) => { curEA = a; steps.push(step(src || 'IR', 'MEM', a,
    'Address $' + hex4(a) + ' → address bus', () => { lastMemAddr = a; }, 'hex4', 'addr', a)); };
  const readData = (to, v, desc, apply) => steps.push(step('MEM', to, v, desc, apply, 'hex2', 'data', curEA));
  const writeData = (from, v, desc, apply) => steps.push(step(from, 'MEM', v, desc, apply, 'hex2', 'data', curEA));
  const internal = (from, to, v, desc, apply) => steps.push(step(from, to, v, desc, apply, 'hex2', 'internal'));

  switch (mnemonic) {
    // ---- loads ----
    case 'LDA': case 'LDX': case 'LDY': {
      const r = mnemonic[2];
      const p2 = setNZ(regs.P, operand);
      addrOut(ea, mode === 'imm' ? 'PC' : 'IR');
      readData(r, operand, 'Load $' + hex2(operand) + ' → ' + r,
        () => { regs[r] = operand; regs.P = p2; });
      break;
    }
    // ---- stores ----
    case 'STA': case 'STX': case 'STY': {
      const r = mnemonic[2];
      const val = regs[r];
      const target = ea;                       // effective address (handles abs,X / abs,Y)
      addrOut(target);
      writeData(r, val, 'Store ' + r + ' ($' + hex2(val) + ') → $' + hex4(target),
        () => { mem[target] = val; lastMemAddr = target; });
      break;
    }
    // ---- register transfers ----
    case 'TAX': case 'TAY': case 'TXA': case 'TYA': {
      const src = mnemonic[1], dst = mnemonic[2];
      const val = regs[src], p2 = setNZ(regs.P, val);
      internal(src, dst, val, mnemonic + ': ' + src + ' → ' + dst,
        () => { regs[dst] = val; regs.P = p2; });
      break;
    }
    // ---- inc/dec register (through ALU) ----
    case 'INX': case 'INY': case 'DEX': case 'DEY': {
      const r = mnemonic[2];
      const res = (regs[r] + (mnemonic[0] === 'I' ? 1 : -1)) & 0xff;
      const p2 = setNZ(regs.P, res);
      internal(r, 'ALU', regs[r], r + ' → ALU');
      internal('ALU', r, res, mnemonic + ': ' + r + ' = $' + hex2(res),
        () => { regs[r] = res; regs.P = p2; });
      break;
    }
    // ---- inc/dec memory ----
    case 'INC': case 'DEC': {
      const res = (operand + (mnemonic[0] === 'I' ? 1 : -1)) & 0xff;
      const p2 = setNZ(regs.P, res);
      addrOut(addr);
      readData('ALU', operand, 'RAM $' + hex2(operand) + ' → ALU');
      addrOut(addr);
      writeData('ALU', res, mnemonic + ': $' + hex4(addr) + ' = $' + hex2(res),
        () => { mem[addr] = res; lastMemAddr = addr; regs.P = p2; });
      break;
    }
    // ---- ALU: add / subtract with carry (binary + BCD decimal mode) ----
    case 'ADC': case 'SBC': {
      const a = regs.A, cin = flagSet(FC) ? 1 : 0, dec = flagSet(FD);
      const m = operand;
      let res, carryOut, binRes;
      if (mnemonic === 'ADC') {
        const bin = a + m + cin; binRes = bin & 0xff;
        if (dec) {
          let lo = (a & 0x0f) + (m & 0x0f) + cin;
          if (lo > 0x09) lo += 0x06;
          let hi = (a >> 4) + (m >> 4) + (lo > 0x0f ? 1 : 0);
          if (hi > 0x09) hi += 0x06;
          res = ((hi << 4) | (lo & 0x0f)) & 0xff;
          carryOut = hi > 0x0f;
        } else { res = binRes; carryOut = bin > 0xff; }
      } else { // SBC
        const bin = a - m - (1 - cin); binRes = bin & 0xff;
        if (dec) {
          let lo = (a & 0x0f) - (m & 0x0f) + cin - 1;
          let hi = (a >> 4) - (m >> 4);
          if (lo < 0) { lo += 10; hi -= 1; }
          if (hi < 0) hi += 10;
          res = ((hi & 0x0f) << 4) | (lo & 0x0f);
        } else { res = binRes; }
        carryOut = bin >= 0;
      }
      let p = setNZ(regs.P, res);
      p = carryOut ? (p | FC) : (p & ~FC);
      const mEff = (mnemonic === 'SBC') ? (m ^ 0xff) : m;   // overflow uses 2's-complement view
      p = (~(a ^ mEff) & (a ^ binRes) & 0x80) ? (p | FV) : (p & ~FV);
      internal('A', 'ALU', a, 'A ($' + hex2(a) + ') → ALU');
      addrOut(ea, mode === 'imm' ? 'PC' : 'IR');
      readData('ALU', m, 'operand $' + hex2(m) + ' → ALU' + (dec ? '  (decimal)' : ''));
      internal('ALU', 'A', res, mnemonic + ': A = $' + hex2(res) + '  C=' + (carryOut ? 1 : 0),
        () => { regs.A = res; regs.P = p; });
      break;
    }
    // ---- compares ----
    case 'CMP': case 'CPX': case 'CPY': {
      const r = mnemonic === 'CMP' ? 'A' : mnemonic[2];
      const t = regs[r], d = (t - operand) & 0xff;
      let p = setNZ(regs.P, d);
      p = t >= operand ? (p | FC) : (p & ~FC);
      internal(r, 'ALU', t, r + ' ($' + hex2(t) + ') → ALU');
      addrOut(ea, mode === 'imm' ? 'PC' : 'IR');
      readData('ALU', operand, 'operand $' + hex2(operand) + ' → ALU');
      internal('ALU', 'P', d, mnemonic + ': compare → ' + flagLetters(p),
        () => { regs.P = p; });
      break;
    }
    // ---- logic ----
    case 'AND': case 'ORA': case 'EOR': {
      const a = regs.A;
      const res = mnemonic === 'AND' ? (a & operand) : mnemonic === 'ORA' ? (a | operand) : (a ^ operand);
      const p2 = setNZ(regs.P, res);
      internal('A', 'ALU', a, 'A ($' + hex2(a) + ') → ALU');
      addrOut(ea, mode === 'imm' ? 'PC' : 'IR');
      readData('ALU', operand, 'operand $' + hex2(operand) + ' → ALU');
      internal('ALU', 'A', res, mnemonic + ': A = $' + hex2(res),
        () => { regs.A = res; regs.P = p2; });
      break;
    }
    // ---- flag ops ----
    case 'CLC': case 'SEC': case 'CLD': case 'SED': case 'CLV': {
      const map = { CLC: [FC, 0], SEC: [FC, 1], CLD: [FD, 0], SED: [FD, 1], CLV: [FV, 0] };
      const [mask, on] = map[mnemonic];
      const p2 = on ? (regs.P | mask) : (regs.P & ~mask);
      internal('IR', 'P', null, mnemonic + ': status → ' + flagLetters(p2),
        () => { regs.P = p2; });
      steps[steps.length - 1].fmt = 'none';
      break;
    }
    // ---- jumps & subroutines ----
    case 'JMP':
      internal('IR', 'PC', addr, 'JMP → $' + hex4(addr), () => { regs.PC = addr; });
      steps[steps.length - 1].fmt = 'hex4';
      break;
    case 'JSR': {
      const ret = (fall - 1) & 0xffff;
      addrOut(0x100 + regs.SP);
      writeData('PC', ret, 'push return $' + hex4(ret) + ' → stack', () => {
        mem[0x100 + regs.SP] = (ret >> 8) & 0xff; regs.SP = (regs.SP - 1) & 0xff;
        mem[0x100 + regs.SP] = ret & 0xff; regs.SP = (regs.SP - 1) & 0xff;
        lastMemAddr = 0x100 + regs.SP;
      });
      internal('IR', 'PC', addr, 'JSR → $' + hex4(addr), () => { regs.PC = addr; });
      steps[steps.length - 1].fmt = 'hex4';
      break;
    }
    case 'RTS': {
      const lo = mem[0x100 + ((regs.SP + 1) & 0xff)];
      const hi = mem[0x100 + ((regs.SP + 2) & 0xff)];
      const ret = (((hi << 8) | lo) + 1) & 0xffff;
      addrOut(0x100 + ((regs.SP + 1) & 0xff));
      readData('PC', ret, 'RTS → $' + hex4(ret),
        () => { regs.SP = (regs.SP + 2) & 0xff; regs.PC = ret; });
      steps[steps.length - 1].fmt = 'hex4';
      break;
    }
    case 'PHA': {
      const sp = 0x100 + regs.SP;
      addrOut(sp);
      writeData('A', regs.A, 'PHA: push A → $' + hex4(sp),
        () => { mem[sp] = regs.A; regs.SP = (regs.SP - 1) & 0xff; lastMemAddr = sp; });
      break;
    }
    case 'PLA': {
      const sp = 0x100 + ((regs.SP + 1) & 0xff);
      const val = mem[sp], p2 = setNZ(regs.P, val);
      addrOut(sp);
      readData('A', val, 'PLA: pull $' + hex2(val) + ' → A',
        () => { regs.SP = (regs.SP + 1) & 0xff; regs.A = val; regs.P = p2; lastMemAddr = sp; });
      break;
    }
    // ---- branches ----
    case 'BNE': case 'BEQ': case 'BCC': case 'BCS': case 'BPL': case 'BMI': {
      const taken = {
        BNE: !flagSet(FZ), BEQ: flagSet(FZ), BCC: !flagSet(FC),
        BCS: flagSet(FC), BPL: !flagSet(FN), BMI: flagSet(FN),
      }[mnemonic];
      if (taken) {
        internal('IR', 'PC', addr, mnemonic + ' taken → $' + hex4(addr), () => { regs.PC = addr; });
        steps[steps.length - 1].fmt = 'hex4';
      } else {
        steps.push(note(mnemonic + ' not taken (fall through)', () => {}));
      }
      break;
    }
    case 'NOP':
      steps.push(note('NOP — no operation', () => {}));
      break;
  }

  return { steps, halt: false };
}

function flagLetters(p) {
  const names = ['N', 'V', '-', 'B', 'D', 'I', 'Z', 'C'];
  const masks = [FN, FV, FU, FB, FD, FI, FZ, FC];
  return names.map((n, i) => (p & masks[i]) ? n : n.toLowerCase()).join('');
}
