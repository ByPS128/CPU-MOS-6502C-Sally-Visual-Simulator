// --- Schematic geometry + drawing (white background, black wireframe) ---------
// A simplified Atari-800-style architecture, laid out left-to-right:
//   ASM panel | CPU package (registers/ALU/decoder) | ADDRESS+DATA buses |
//   memory-mapped chips | TV | DISPLAY LIST | VRAM window | RAM window
// The CPU dot and ANTIC dot animate along the buses; the TV shows what ANTIC
// paints; the Display List panel disassembles ANTIC's program (live-highlighted);
// VRAM is a static window into screen memory, RAM follows the last access.

const CW = 1690, CH = 820;

// ---- ASM panel ----
const AX = 16, AY = 96, AW = 360, AH = 664;

// ---- CPU package ----
const CPU_X = 410, CPU_Y = 150, CPU_W = 350, CPU_H = 350;   // 150..500
const XMID = CPU_X + CPU_W / 2;                              // internal data bus x = 585
const CPU_R = CPU_X + CPU_W;                                 // right edge = 760
const REG_H = 40;
const COL_L_X = 425, COL_R_X = 605, COL_W = 140;            // two register columns
const EDGE_L = COL_L_X + COL_W;                              // 565 (left col right edge)
const EDGE_R = COL_R_X;                                      // 605 (right col left edge)

// ---- buses ----
const ADDR_BUS_Y = 225, DATA_BUS_Y = 285;
const BUS_END = 1668;
const ADDR_PIN = { x: CPU_R, y: ADDR_BUS_Y };
const DATA_PIN = { x: CPU_R, y: DATA_BUS_Y };

// ---- VRAM viewer (static window into RAM at the screen memory) ----
const VR_X = 1300, VR_W = 176, VR_Y = 315, VR_H = 445;

// ---- RAM (active, bus-connected device; window follows last access) ----
const RAM_X = 1492, RAM_W = 176, RAM_Y = 315, RAM_H = 445;  // 315..760
const RAM_TAPX = RAM_X + RAM_W / 2;                          // 1240
const RAM_TOPY = RAM_Y;

// ---- memory-mapped chips (light up when their address range is accessed) ----
const CHIP_Y = 330, CHIP_H = 80, CHIP_W = 92;
const CHIPS = [
  { key: 'OS ROM',     label: 'OS ROM',     cx: 850,  test: a => a >= 0xC000 && (a < 0xD000 || a >= 0xD800) },
  { key: 'ANTIC/GTIA', label: 'ANTIC/GTIA', cx: 958,  test: a => (a >= 0xD000 && a < 0xD200) || (a >= 0xD400 && a < 0xD600) },
  { key: 'POKEY/PIA',  label: 'POKEY/PIA',  cx: 1066, test: a => a >= 0xD200 && a < 0xD400 },
];

// ---- TV (what ANTIC paints) ----
const TV_X = 812, TV_Y = 455, TV_W = 232, TV_H = 240, TV_GRID = 184;

// ---- Display List panel (ANTIC's "program", disassembled) ----
const DLP_X = 1060, DLP_Y = 455, DLP_W = 224, DLP_H = 240;

// Path the ANTIC DMA dot travels: RAM (picture data) -> data bus -> ANTIC.
function anticDataPath() {
  const cx = CHIPS[1].cx;
  return [
    { x: RAM_TAPX, y: RAM_TOPY },
    { x: RAM_TAPX, y: DATA_BUS_Y },
    { x: cx, y: DATA_BUS_Y },
    { x: cx, y: CHIP_Y },
  ];
}

// Address decoding: which device answers for a given address?
function deviceFor(addr) {
  if (addr !== undefined && addr !== null)
    for (const c of CHIPS) if (c.test(addr)) return { tapX: c.cx, top: CHIP_Y, key: c.key };
  return { tapX: RAM_TAPX, top: RAM_TOPY, key: 'RAM' };
}

function regNode(name, label, col, cy) {
  const x = col === 'L' ? COL_L_X : COL_R_X;
  return {
    name, label, col, x, y: cy - REG_H / 2, w: COL_W, h: REG_H,
    cx: x + COL_W / 2, cy, edgeX: col === 'L' ? EDGE_L : EDGE_R,
  };
}

const NODES = {
  A:   regNode('A',   'A',   'L', 195),
  X:   regNode('X',   'X',   'L', 255),
  Y:   regNode('Y',   'Y',   'L', 315),
  P:   regNode('P',   'P',   'L', 375),
  PC:  regNode('PC',  'PC',  'R', 195),
  SP:  regNode('SP',  'SP',  'R', 255),
  IR:  regNode('IR',  'IR',  'R', 315),
  ALU: regNode('ALU', 'ALU', 'R', 375),
};

// ---- Routing: build the polyline the dot travels for a step ------------------
function routePath(from, to, bus, at) {
  if (bus === 'internal') return internalPath(from, to);

  // memory transfer: exactly one endpoint is 'MEM'; route to the decoded device
  const reg = (from === 'MEM') ? to : from;
  const n = NODES[reg];
  const busY = (bus === 'addr') ? ADDR_BUS_Y : DATA_BUS_Y;
  const dev = deviceFor(at);
  const path = [
    { x: n.edgeX, y: n.cy },      // leave register
    { x: XMID, y: n.cy },         // onto internal bus
    { x: XMID, y: busY },         // up/down internal bus to pin level
    { x: dev.tapX, y: busY },     // across the external bus (passes the CPU pin)
    { x: dev.tapX, y: dev.top },  // down into the device
  ];
  return (from === 'MEM') ? dedupe(path.reverse()) : dedupe(path);
}

function internalPath(from, to) {
  const a = NODES[from], b = NODES[to];
  return dedupe([
    { x: a.edgeX, y: a.cy },
    { x: XMID, y: a.cy },
    { x: XMID, y: b.cy },
    { x: b.edgeX, y: b.cy },
  ]);
}

function dedupe(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], q = out[out.length - 1];
    if (p.x !== q.x || p.y !== q.y) out.push(p);
  }
  return out;
}

// ---- Drawing ----------------------------------------------------------------

function drawSchematic(activeNode, activeDevice) {
  drawBuses();
  drawChips(activeDevice);
  drawTV();
  drawDisplayList();
  drawVRAM();
  drawRAM(activeDevice);
  drawCPU(activeNode);
}

// A second, STATIC window into RAM fixed at the screen memory ($1000), so you can
// watch the Hello World program copy characters in (the RAM window jumps around).
function drawVRAM() {
  drawBox(VR_X, VR_Y, VR_W, VR_H);
  label('VRAM — screen memory', VR_X + 10, VR_Y + 8, 11);
  noStroke(); fill(110); textSize(9); textAlign(LEFT, TOP);
  text('static window into RAM @ $1000', VR_X + 12, VR_Y + 24);
  fill(0);

  const base = 0x1000;
  let y = VR_Y + 42;
  textSize(12);
  for (let i = 0; i < 16; i++) {
    const a = base + i, v = mem[a];
    if (a === lastMemAddr) { noStroke(); fill(0); rect(VR_X + 8, y - 2, VR_W - 16, 20); fill(255); }
    else fill(0);
    noStroke();
    const ch = (v === 0) ? '·' : (v < 0x40 ? String.fromCharCode(v + 0x20) : '?');
    textAlign(LEFT, TOP);  text('$' + hex4(a), VR_X + 14, y);
    textAlign(RIGHT, TOP); text('$' + hex2(v) + '  ' + ch, VR_X + VR_W - 14, y);
    y += 22;
  }
  noStroke(); fill(110); textSize(9); textAlign(LEFT, BOTTOM);
  text('watch the copy loop fill it', VR_X + 12, VR_Y + VR_H - 8);
  fill(0);
}

// Decode the ANTIC Display List in memory into disassembler-style entries.
function decodeDisplayList(base) {
  const out = [];
  let a = base & 0xffff;
  for (let n = 0; n < 24; n++) {
    const b = mem[a];
    let len = 1, text;
    if ((b & 0x0f) === 0) {                                   // blank-line instruction
      text = 'BLANK ' + (((b >> 4) & 7) + 1);
    } else if (b === 0x01 || b === 0x41) {                    // JMP / JVB (2-byte address)
      const t = mem[(a + 1) & 0xffff] | (mem[(a + 2) & 0xffff] << 8);
      len = 3; text = (b === 0x41 ? 'JVB  $' : 'JMP  $') + hex4(t);
    } else {                                                  // mode line (+ optional LMS)
      const mode = b & 0x0f;
      if (b & 0x40) {
        const t = mem[(a + 1) & 0xffff] | (mem[(a + 2) & 0xffff] << 8);
        len = 3; text = 'MODE ' + mode + ' +LMS $' + hex4(t);
      } else { text = 'MODE ' + mode; }
    }
    const bytes = [];
    for (let i = 0; i < len; i++) bytes.push(mem[(a + i) & 0xffff]);
    out.push({ addr: a, bytes, text });
    if (b === 0x41) break;                                    // JVB ends the list
    a = (a + len) & 0xffff;
  }
  return out;
}

function drawDisplayList() {
  drawBox(DLP_X, DLP_Y, DLP_W, DLP_H);
  const start = (typeof anticDLStart === 'function') ? anticDLStart() : 0x0700;
  label('DISPLAY LIST — ANTIC program @ $' + hex4(start), DLP_X + 10, DLP_Y + 8, 10);
  noStroke(); fill(110); textSize(8); textAlign(LEFT, TOP);
  text('addr  bytes      meaning', DLP_X + 12, DLP_Y + 24);
  fill(0);

  const list = decodeDisplayList(start);
  const cur = (typeof anticDP !== 'undefined') ? anticDP : -1;
  const live = (typeof anticLive !== 'undefined') && anticLive;
  let y = DLP_Y + 38;
  const lh = 15;
  textSize(10);
  for (const e of list) {
    if (live && e.addr === cur) { noStroke(); fill(0); rect(DLP_X + 6, y - 1, DLP_W - 12, lh - 1); fill(255); }
    else fill(0);
    noStroke(); textAlign(LEFT, TOP);
    const bytesStr = e.bytes.map(hex2).join(' ').padEnd(8, ' ');
    text(hex4(e.addr) + '  ' + bytesStr + '  ' + e.text, DLP_X + 12, y);
    y += lh;
  }
  noStroke(); fill(90); textSize(9); textAlign(LEFT, BOTTOM);
  const dma = (typeof anticDMA !== 'undefined') ? anticDMA : null;
  const foot = (live && dma)
    ? '▶ reading screen $' + hex4(dma.addr) + ' → TV row ' + dma.row
    : 'highlighted = line ANTIC is running now';
  text(foot, DLP_X + 12, DLP_Y + DLP_H - 7);
  fill(0);
}

function drawBox(x, y, w, h) { stroke(0); strokeWeight(1.5); noFill(); rect(x, y, w, h, 3); }

function label(txt, x, y, size, alignX, alignY) {
  noStroke(); fill(0); textSize(size || 12);
  textAlign(alignX || LEFT, alignY || TOP); text(txt, x, y);
}

function drawBuses() {
  // address + data trunks
  stroke(0); strokeWeight(3);
  line(ADDR_PIN.x, ADDR_BUS_Y, BUS_END, ADDR_BUS_Y);
  line(DATA_PIN.x, DATA_BUS_Y, BUS_END, DATA_BUS_Y);
  strokeWeight(1);
  label('ADDRESS BUS (16-bit)', CPU_R + 8, ADDR_BUS_Y - 16, 12);
  label('DATA BUS (8-bit)', CPU_R + 8, DATA_BUS_Y + 6, 12);
}

function drawChips(activeDevice) {
  for (const c of CHIPS) {
    const isAntic = (c.key === 'ANTIC/GTIA');
    const anticRunning = isAntic && (typeof anticLive !== 'undefined') && anticLive;
    const live = (c.key === activeDevice) || anticRunning;       // drawn in ink (not grey)
    const hot = (c.key === activeDevice) || (isAntic && typeof anticDMA !== 'undefined' && anticDMA);
    const ink = live ? 0 : 160;
    // connect to both buses
    stroke(ink); strokeWeight(hot ? 2.5 : 1.5);
    line(c.cx, CHIP_Y, c.cx, ADDR_BUS_Y);
    drawDot4(c.cx, ADDR_BUS_Y); drawDot4(c.cx, DATA_BUS_Y);
    // box
    if (hot) { noStroke(); fill(230); rect(c.cx - CHIP_W / 2, CHIP_Y, CHIP_W, CHIP_H, 3); }
    stroke(ink); strokeWeight(hot ? 2.5 : 1.5); noFill();
    rect(c.cx - CHIP_W / 2, CHIP_Y, CHIP_W, CHIP_H, 3);
    noStroke(); fill(live ? 0 : 150);
    textAlign(CENTER, CENTER); textSize(11);
    text(c.label, c.cx, CHIP_Y + CHIP_H / 2 - 6);
    textSize(9);
    const sub = (c.key === activeDevice) ? 'I/O active' : anticRunning ? 'painting…' : 'mem-mapped';
    text(sub, c.cx, CHIP_Y + CHIP_H / 2 + 10);
  }
  fill(0);
}

function drawTV() {
  const cx = CHIPS[1].cx;
  const on = (typeof anticLive !== 'undefined') && anticLive;
  // ANTIC -> TV "video out" wire
  stroke(on ? 0 : 160); strokeWeight(1.5);
  line(cx, CHIP_Y + CHIP_H, cx, TV_Y);
  noStroke(); fill(on ? 0 : 150); textSize(9); textAlign(CENTER, CENTER);
  text('video out', cx, (CHIP_Y + CHIP_H + TV_Y) / 2);

  drawBox(TV_X, TV_Y, TV_W, TV_H);
  label('TV — ANTIC text mode (reads $1000)', TV_X + 10, TV_Y + 8, 11);

  const cols = (typeof anticCols !== 'undefined') ? anticCols : 20;
  const rows = (typeof anticRows !== 'undefined') ? anticRows : 4;
  const pxW = cols * 8, pxH = rows * 8;
  const areaW = TV_W - 20, areaH = TV_H - 56;
  const cell = Math.max(1, Math.floor(Math.min(areaW / pxW, areaH / pxH)));
  const gw = pxW * cell, gh = pxH * cell;
  const gx = TV_X + (TV_W - gw) / 2, gy = TV_Y + 30 + (areaH - gh) / 2;

  noStroke(); fill(244); rect(gx - 4, gy - 4, gw + 8, gh + 8);    // screen background
  fill(0);
  const font = (typeof ATARI_FONT !== 'undefined') ? ATARI_FONT : null;
  if (font) for (let i = 0; i < cols * rows; i++) {
    const code = (typeof tvCells !== 'undefined' && tvCells[i] != null) ? (tvCells[i] & 0x7f) : 0;
    const glyph = font[code]; if (!glyph) continue;
    const cc = i % cols, rr = Math.floor(i / cols);
    for (let gr = 0; gr < 8; gr++) {
      const byte = glyph[gr]; if (!byte) continue;
      for (let gb = 0; gb < 8; gb++) if (byte & (0x80 >> gb))
        rect(gx + (cc * 8 + gb) * cell, gy + (rr * 8 + gr) * cell, cell, cell);
    }
  }
  noFill(); stroke(0); strokeWeight(1); rect(gx - 4, gy - 4, gw + 8, gh + 8);
  noStroke(); fill(110); textSize(9); textAlign(CENTER, BOTTOM);
  const frames = (typeof anticFrames !== 'undefined') ? anticFrames : 0;
  text(on ? ('ANTIC walks Display List @ $0700  ·  frames: ' + frames) : 'ANTIC idle',
    TV_X + TV_W / 2, TV_Y + TV_H - 8);
  fill(0);
}

function drawDot4(x, y) { noStroke(); fill(0); circle(x, y, 5); }

function drawRAM(activeDevice) {
  // bus tap (bolder while RAM is the active device)
  stroke(0); strokeWeight(activeDevice === 'RAM' ? 2.5 : 1.5);
  line(RAM_TAPX, RAM_TOPY, RAM_TAPX, ADDR_BUS_Y);
  drawDot4(RAM_TAPX, ADDR_BUS_Y); drawDot4(RAM_TAPX, DATA_BUS_Y);

  drawBox(RAM_X, RAM_Y, RAM_W, RAM_H);
  label('RAM  (64 KB)', RAM_X + 12, RAM_Y + 8, 13);
  label(lastMemAddr >= 0 ? '$' + hex4(lastMemAddr) + ' = $' + hex2(mem[lastMemAddr]) : '—',
    RAM_X + RAM_W - 12, RAM_Y + 9, 10, RIGHT, TOP);

  // a 16-cell window around the most recent access
  const base = ((lastMemAddr < 0 ? 0x0600 : lastMemAddr) & 0xfff0);
  let y = RAM_Y + 36;
  textSize(12);
  for (let i = 0; i < 16; i++) {
    const a = (base + i) & 0xffff;
    if (a === lastMemAddr) { noStroke(); fill(0); rect(RAM_X + 8, y - 2, RAM_W - 16, 20); fill(255); }
    else fill(0);
    noStroke();
    textAlign(LEFT, TOP);  text('$' + hex4(a), RAM_X + 14, y);
    textAlign(RIGHT, TOP); text('$' + hex2(mem[a]), RAM_X + RAM_W - 14, y);
    y += 22;
  }
  fill(0); textAlign(LEFT, BOTTOM); textSize(10);
  text('window follows last access', RAM_X + 12, RAM_Y + RAM_H - 8);
}

function drawCPU(activeNode) {
  // package outline
  drawBox(CPU_X, CPU_Y, CPU_W, CPU_H);
  label('CPU — MOS 6502C "Sally"', CPU_X + 12, CPU_Y + 8, 14);

  // internal bus (vertical spine) + pin stubs — stops at the control unit top
  stroke(0); strokeWeight(2);
  line(XMID, 175, XMID, 420);
  strokeWeight(1.5);
  line(XMID, ADDR_BUS_Y, ADDR_PIN.x, ADDR_BUS_Y);   // -> address pin
  line(XMID, DATA_BUS_Y, DATA_PIN.x, DATA_BUS_Y);    // -> data pin
  // taps from each register to the internal bus
  for (const k in NODES) {
    const n = NODES[k];
    line(n.edgeX, n.cy, XMID, n.cy);
  }
  noStroke(); fill(120); textSize(9);
  push(); translate(XMID - 6, 360); rotate(-HALF_PI); text('internal bus', 0, 0); pop();
  fill(0);

  // register / unit boxes
  drawReg('A',  'A — Accumulator',   hex2(regs.A),  bin8(regs.A),  activeNode);
  drawReg('X',  'X — Index',         hex2(regs.X),  bin8(regs.X),  activeNode);
  drawReg('Y',  'Y — Index',         hex2(regs.Y),  bin8(regs.Y),  activeNode);
  drawStatus(activeNode);
  drawReg('PC', 'PC — Program Ctr',  hex4(regs.PC), null,          activeNode, true);
  drawReg('SP', 'SP — Stack ($01xx)',hex2(regs.SP), null,          activeNode);
  drawReg('IR', 'IR — Instruction',  hex2(regs.IR), null,          activeNode);
  drawAlu(activeNode);

  // control / decode unit
  drawBox(COL_L_X, 420, EDGE_R + COL_W - COL_L_X, 46);
  label('CONTROL UNIT / INSTRUCTION DECODE', COL_L_X + 10, 420 + 16, 12);

  drawControlSignals();
}

function drawReg(key, lbl, value, sub, activeNode, wide) {
  const n = NODES[key];
  if (activeNode === key) { noStroke(); fill(230); rect(n.x, n.y, n.w, n.h, 3); }
  drawBox(n.x, n.y, n.w, n.h);
  label(lbl, n.x + 8, n.y + 4, 9.5);
  noStroke(); fill(0); textAlign(RIGHT, BOTTOM); textSize(wide ? 16 : 17);
  text('$' + value, n.x + n.w - 10, n.y + n.h - 4);
  if (sub) { textAlign(LEFT, BOTTOM); textSize(8); fill(110); text(sub, n.x + 8, n.y + n.h - 4); fill(0); }
}

function drawStatus(activeNode) {
  const n = NODES.P;
  if (activeNode === 'P') { noStroke(); fill(230); rect(n.x, n.y, n.w, n.h, 3); }
  drawBox(n.x, n.y, n.w, n.h);
  label('P — Status (flags)', n.x + 8, n.y + 4, 9.5);
  const names = ['N', 'V', '-', 'B', 'D', 'I', 'Z', 'C'];
  const masks = [FN, FV, FU, FB, FD, FI, FZ, FC];
  const bw = 15, x0 = n.x + 7, by = n.y + n.h - 19;
  textAlign(CENTER, CENTER); textSize(11);
  for (let i = 0; i < 8; i++) {
    const on = (regs.P & masks[i]) !== 0;
    const bx = x0 + i * (bw + 1.5);
    if (on) { noStroke(); fill(0); rect(bx, by, bw, 15); fill(255); }
    else { noFill(); stroke(0); strokeWeight(1); rect(bx, by, bw, 15); noStroke(); fill(0); }
    text(names[i], bx + bw / 2, by + 8);
  }
  fill(0);
}

function drawAlu(activeNode) {
  const n = NODES.ALU;
  if (activeNode === 'ALU') { noStroke(); fill(230); rect(n.x, n.y, n.w, n.h, 3); }
  drawBox(n.x, n.y, n.w, n.h);
  label('ALU', n.x + 8, n.y + 4, 9.5);
  noStroke(); fill(0); textAlign(RIGHT, BOTTOM); textSize(11);
  text('arith / logic', n.x + n.w - 8, n.y + n.h - 5);
}

// Control + interrupt signal pins along the CPU's bottom edge.
// HALT lights while ANTIC steals the bus; NMI lights on VBLANK.
function drawControlSignals() {
  const sigs = ['φ2', 'R/W', 'HALT', 'IRQ', 'NMI', 'RES'];
  const active = {
    HALT: (typeof anticHalt !== 'undefined') && anticHalt,
    NMI: (typeof nmiFlash !== 'undefined') && nmiFlash > 0,
  };
  const yEdge = CPU_Y + CPU_H;
  const x0 = CPU_X + 30, span = CPU_W - 60;
  for (let i = 0; i < sigs.length; i++) {
    const x = x0 + span * (i / (sigs.length - 1));
    const hot = active[sigs[i]];
    stroke(0); strokeWeight(hot ? 3 : 1.5);
    line(x, yEdge, x, yEdge + 16);
    if (hot) { noStroke(); fill(0); circle(x, yEdge + 16, 8); }
    noStroke(); fill(0); textAlign(CENTER, TOP);
    textSize(hot ? 11 : 10);
    if (hot) { text(sigs[i] + ' ●', x, yEdge + 21); } else { text(sigs[i], x, yEdge + 19); }
  }
  noStroke(); fill(110); textAlign(LEFT, TOP); textSize(9);
  text('control & interrupt lines', CPU_X, yEdge + 34);
  fill(0);
}

function drawASM(currentLine) {
  drawBox(AX, AY, AW, AH);
  label('ASSEMBLY  —  ' + currentDemoName, AX + 10, AY + 8, 12);

  const addrOf = (ln) => (ln.addr !== null && ln.addr !== undefined) ? hex4(ln.addr) + '  ' : '      ';
  const avail = AW - 24;

  // Auto-fit: shrink the font just enough that the widest line fits the panel
  // (monospace scales linearly), so nothing ever spills into the schematic.
  textSize(13);
  let maxW = 1;
  for (const ln of asm.lines) maxW = Math.max(maxW, textWidth(addrOf(ln) + ln.raw));
  const fs = Math.max(8, Math.min(13, Math.floor(13 * avail / maxW)));
  const lh = fs + 6;

  // clip to the panel interior as a safety net
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(AX + 4, AY + 24, AW - 8, AH - 28);
  drawingContext.clip();

  let y = AY + 32;
  textSize(fs);
  asm.lines.forEach((ln, idx) => {
    if (idx === currentLine) { noStroke(); fill(0); rect(AX + 6, y - 2, AW - 12, lh - 1); fill(255); }
    else fill(0);
    noStroke(); textAlign(LEFT, TOP);
    text(addrOf(ln) + ln.raw, AX + 12, y);
    y += lh;
  });
  drawingContext.restore();
  fill(0);
}
