// --- A tiny two-pass assembler for the demo source ----------------------------
// Supports: `*=` origin, labels, `NAME = value` equates, `label+N`/`-N` math,
// the `.byte` directive (numbers or a "quoted string" auto-converted to Atari
// screen codes), and addressing modes imm/zp/abs/abs,X/abs,Y/(zp),Y/rel.
// Writes machine code into `mem` and returns metadata used by the UI:
//   { origin, end, lines:[{raw, addr|null}], addrToLine:{addr:lineIndex} }
// `origin` is the entry point = address of the FIRST instruction.

function assemble(src, mem) {
  const rawLines = src.replace(/\r/g, '').split('\n');
  let pc = 0x0600;            // current assembly address (follows every *=)
  let firstAddr = null;      // entry point = address of the first instruction
  const labels = {};
  const parsed = [];   // one entry per source line: {raw, instr|null}

  // ---- Pass 1: discover labels and instruction lengths ----
  for (const raw of rawLines) {
    const entry = { raw, instr: null, addr: null };
    let line = raw.split(';')[0];                 // strip comment
    let text = line.trim();

    if (text.startsWith('*=')) {                  // origin directive
      pc = parseNum(text.slice(2).trim());
      parsed.push(entry);
      continue;
    }
    if (text === '') { parsed.push(entry); continue; }

    // Equate:  NAME = value   (defines a symbol/constant)
    const eq = text.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (eq) { labels[eq[1]] = resolve(eq[2], labels) & 0xffff; parsed.push(entry); continue; }

    // Optional leading label: a token that is NOT a mnemonic and NOT a directive.
    let tokens = text.split(/\s+/);
    if (tokens.length && tokens[0].toLowerCase() !== '.byte' && !isMnemonic(tokens[0].replace(/:$/, ''))) {
      labels[tokens[0].replace(/:$/, '')] = pc;
      tokens.shift();
    }
    if (tokens.length === 0) { parsed.push(entry); continue; }

    // .byte directive: comma-separated values; a "quoted string" expands to one
    // byte per character (converted to Atari screen codes).
    if (tokens[0].toLowerCase() === '.byte') {
      const args = tokens.slice(1).join(' ').split(',').map(s => s.trim()).filter(s => s.length);
      entry.data = args;
      entry.addr = pc;
      let count = 0;
      for (const a of args) count += isStr(a) ? (a.length - 2) : 1;
      pc += count;
      parsed.push(entry);
      continue;
    }

    const mnem = tokens[0].toUpperCase();
    const operand = tokens.slice(1).join(' ').trim();
    const mode = detectMode(mnem, operand);
    entry.instr = { mnem, mode, operand };
    entry.addr = pc;
    if (firstAddr === null) firstAddr = pc;
    pc += MODELEN[mode];
    parsed.push(entry);
  }

  // ---- Pass 2: resolve operands and emit bytes ----
  const addrToLine = {};
  const lines = [];
  parsed.forEach((entry, idx) => {
    lines.push({ raw: entry.raw, addr: entry.addr });
    if (entry.data) {                            // .byte data block
      let a = entry.addr;
      for (const tok of entry.data) {
        if (isStr(tok)) {
          const s = tok.slice(1, -1);
          for (const ch of s) mem[a++] = atasciiToScreen(ch.charCodeAt(0));
        } else {
          mem[a++] = resolve(tok, labels) & 0xff;
        }
      }
      return;
    }
    if (!entry.instr) return;
    addrToLine[entry.addr] = idx;

    const { mnem, mode, operand } = entry.instr;
    const op = OPENC[mnem + '/' + mode];
    if (op === undefined) throw new Error('Unknown instruction: ' + mnem + ' (' + mode + ')');
    let a = entry.addr;
    mem[a++] = op;

    if (mode === 'imm') {
      mem[a] = parseNum(operand.replace('#', '')) & 0xff;
    } else if (mode === 'zp') {
      mem[a] = resolve(operand, labels) & 0xff;
    } else if (mode === 'abs' || mode === 'absx' || mode === 'absy') {
      const base = operand.replace(/,\s*[XYxy]\s*$/, '').trim();
      const v = resolve(base, labels) & 0xffff;
      mem[a] = v & 0xff; mem[a + 1] = (v >> 8) & 0xff;
    } else if (mode === 'indy') {
      const inner = operand.match(/^\(\s*(.+?)\s*\)\s*,\s*[Yy]\s*$/)[1];
      mem[a] = resolve(inner, labels) & 0xff;   // zero-page pointer address
    } else if (mode === 'rel') {
      const target = resolve(operand, labels);
      const off = (target - (entry.addr + 2)) & 0xff;   // signed byte
      mem[a] = off;
    }
  });

  return { origin: firstAddr === null ? 0x0600 : firstAddr, end: pc, lines, addrToLine };
}

function isMnemonic(tok) { return OPDECODE && Object.values(OPDECODE).some(d => d.mnemonic === tok.toUpperCase()); }

function detectMode(mnem, operand) {
  if (BRANCHES.includes(mnem)) return 'rel';
  if (operand === '' || operand === undefined) return 'imp';
  if (operand.startsWith('#')) return 'imm';
  // indirect indexed: (zp),Y  — must be checked before the plain ,Y case
  if (/^\(\s*.+\s*\)\s*,\s*[Yy]\s*$/.test(operand)) return 'indy';
  // indexed: operand ends with ,X or ,Y
  const ix = operand.match(/,\s*([XYxy])\s*$/);
  if (ix) return ix[1].toUpperCase() === 'X' ? 'absx' : 'absy';
  // numeric literal with at most 2 hex digits => zero page (if supported)
  const m = operand.match(/^\$([0-9A-Fa-f]+)$/);
  if (m && m[1].length <= 2 && (OPENC[mnem + '/zp'] !== undefined)) return 'zp';
  return 'abs';
}

function parseNum(s) {
  s = s.trim();
  if (s.startsWith('$')) return parseInt(s.slice(1), 16);
  if (s.startsWith('%')) return parseInt(s.slice(1), 2);
  return parseInt(s, 10);
}

// Resolve an operand expression: a single term, or terms joined by + / - .
function resolve(operand, labels) {
  const parts = operand.split(/([+-])/).map(s => s.trim()).filter(s => s.length);
  let total = resolveTerm(parts[0], labels);
  for (let i = 1; i < parts.length; i += 2) {
    const v = resolveTerm(parts[i + 1], labels);
    total += (parts[i] === '-') ? -v : v;
  }
  return total & 0xffff;
}
function resolveTerm(t, labels) {
  t = t.trim();
  if (t.startsWith('$') || t.startsWith('%') || /^[0-9]/.test(t)) return parseNum(t);
  if (t in labels) return labels[t];
  throw new Error('Unresolved symbol: ' + t);
}

function isStr(t) { return t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"'; }

// ATASCII character -> Atari internal screen code (so text shows correctly).
function atasciiToScreen(c) {
  if (c <= 0x1F) return (c + 0x40) & 0xff;
  if (c <= 0x7F) return (c - 0x20) & 0xff;
  return c & 0xff;
}
