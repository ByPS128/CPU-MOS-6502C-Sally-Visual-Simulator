// --- ANTIC: the Atari's video coprocessor, driven by a real Display List ------
// ANTIC is a DMA coprocessor. Every frame it walks a Display List in RAM and, for
// each text (mode 2) line, reads character codes from screen memory and looks
// each one up in the Atari font (ATARI_FONT) to paint the TV. The CPU just writes
// characters into screen memory ($1000) — ANTIC shows them on the next frame
// (no "flush"). While ANTIC reads the bus it HALTs the 6502C "Sally"
// (cycle-stealing); after the last line it rests (vertical blank) and raises NMI,
// letting the CPU run free. All timing follows the speed slider via stepFrames().
//
// A demo can install its OWN display list (e.g. graphics mode F) by pointing the
// SDLST shadow at it — anticDecodeDL then renders text or bitmap accordingly.
//
// Memory map (text set up by anticReset, like the Atari OS does for GRAPHICS 0):
//   $0480  text Display List    $1000  screen memory (20x4 text, or a bitmap)
//   shadow regs: $0230/$0231 = DL ptr,  $0058/$0059 = screen ptr

const ANTIC_DL_BASE = 0x0480;      // OS text display list (off $0700 so demos can place their own DL)
const ANTIC_SCREEN_BASE = 0x1000;
const ANTIC_COLS = 20;             // text columns
const ANTIC_ROWS = 4;              // text rows
const ANTIC_GFX_BYTES = 12;        // bytes/scanline in graphics mode F (12*8 = 96 px wide)
const ANTIC_LINE_COOLDOWN = 3;     // frames the CPU runs between scanline DMAs

let anticLive = true;
let anticGfx = false;              // false = text (mode 2), true = bitmap (mode F)
let anticCols = ANTIC_COLS;        // bytes per row (chars in text, pixel-bytes in graphics)
let anticRows = ANTIC_ROWS;        // number of mode lines this frame
let anticBase = ANTIC_SCREEN_BASE; // screen/bitmap base (from the DL's LMS)
let tvCells = [];                  // length cols*rows: char codes (text) or pixel bytes (graphics)

// frame-walk state
let anticDP = ANTIC_DL_BASE;       // display-list cursor (address in mem)
let anticScan = ANTIC_SCREEN_BASE; // current screen-memory scan address
let anticRowOut = 0;               // which text row we're painting
let anticCurLen = 1;               // length of the DL instruction in flight
let anticDMA = null;               // {path, segs, total, frames, elapsed, row, value, addr}
let anticHalt = false;             // true while ANTIC owns the bus (CPU paused)
let anticCooldown = 0;
let anticIdle = 0;                 // vertical-blank rest (CPU runs free)
let nmiFlash = 0;
let anticFrames = 0;

function anticDMAFrames() { return Math.max(4, Math.round(stepFrames() * 0.7)); }
function anticVBlankFrames() { return Math.max(20, stepFrames() * 4); }

// shadow registers (with sensible fallbacks before the program sets them)
function anticDLStart() { return ((mem[0x0231] << 8) | mem[0x0230]) || ANTIC_DL_BASE; }
function anticScreenStart() { return ((mem[0x0059] << 8) | mem[0x0058]) || ANTIC_SCREEN_BASE; }

// Walk the Display List in memory and report what to render this frame:
//   { gfx, base, rows, cols }   (text mode 2 -> font; graphics mode F -> bitmap)
function anticDecodeDL() {
  let a = anticDLStart();
  let base = anticScreenStart(), found = false, gfx = false, rows = 0;
  for (let n = 0; n < 256; n++) {
    const b = mem[a & 0xffff];
    if (b === 0x41) break;                                   // JVB = end of frame
    if ((b & 0x0f) === 0) { a = (a + 1) & 0xffff; continue; }   // blank lines
    if (b === 0x01) { a = (mem[(a + 1) & 0xffff] | (mem[(a + 2) & 0xffff] << 8)) & 0xffff; continue; } // JMP
    if (b & 0x40) {                                          // mode line with LMS (2 addr bytes)
      const t = mem[(a + 1) & 0xffff] | (mem[(a + 2) & 0xffff] << 8);
      if (!found) { base = t; found = true; }
      a = (a + 3) & 0xffff;
    } else { a = (a + 1) & 0xffff; }
    if ((b & 0x0f) === 0x0f) gfx = true;                     // mode F => graphics
    rows++;
  }
  return { gfx, base, rows, cols: gfx ? ANTIC_GFX_BYTES : ANTIC_COLS };
}

// Lay down a standard GRAPHICS-0-style text Display List + clear the text screen.
function anticReset() {
  // Display List: 24 blank scanlines, mode 2 + LMS -> screen, more mode 2 rows, JVB.
  let d = ANTIC_DL_BASE;
  mem[d++] = 0x70; mem[d++] = 0x70; mem[d++] = 0x70;           // 3x 8 blank scanlines
  mem[d++] = 0x42; mem[d++] = ANTIC_SCREEN_BASE & 0xff; mem[d++] = (ANTIC_SCREEN_BASE >> 8) & 0xff; // mode2 + LMS
  for (let i = 1; i < ANTIC_ROWS; i++) mem[d++] = 0x02;        // remaining mode-2 rows
  mem[d++] = 0x41; mem[d++] = ANTIC_DL_BASE & 0xff; mem[d++] = (ANTIC_DL_BASE >> 8) & 0xff; // JVB -> start

  // clear screen memory to spaces (code 0)
  for (let i = 0; i < ANTIC_COLS * ANTIC_ROWS; i++) mem[ANTIC_SCREEN_BASE + i] = 0x00;

  // shadow registers (the OS would set these)
  mem[0x0230] = ANTIC_DL_BASE & 0xff; mem[0x0231] = (ANTIC_DL_BASE >> 8) & 0xff;
  mem[0x0058] = ANTIC_SCREEN_BASE & 0xff; mem[0x0059] = (ANTIC_SCREEN_BASE >> 8) & 0xff;

  tvCells = [];
  anticFrameStart();          // decode the DL we just laid down -> sets dims + tvCells
  anticDMA = null; anticHalt = false; anticCooldown = 0; anticIdle = 0; nmiFlash = 0; anticFrames = 0;
}

function anticFrameStart() {
  const d = anticDecodeDL();
  anticGfx = d.gfx; anticCols = d.cols; anticRows = Math.max(1, d.rows); anticBase = d.base;
  anticDP = anticDLStart();
  anticScan = d.base;
  anticRowOut = 0;
  if (tvCells.length !== anticCols * anticRows) tvCells = new Array(anticCols * anticRows).fill(0);
}

// Paint one text row: read cols character codes from screen memory into tvCells.
function anticPaintRow(row) {
  for (let c = 0; c < anticCols; c++) tvCells[row * anticCols + c] = mem[(anticScan + c) & 0xffff];
}

// Turbo mode: no DMA animation — ANTIC just repaints the whole screen each frame
// from video memory (per the display list's screen base). No cycle-stealing.
function anticPaintAll() {
  if (nmiFlash > 0) nmiFlash--;
  anticFrameStart();           // decode DL -> dims + base (handles text or graphics)
  for (let r = 0; r < anticRows; r++)
    for (let c = 0; c < anticCols; c++) tvCells[r * anticCols + c] = mem[(anticBase + r * anticCols + c) & 0xffff];
  anticHalt = false; anticDMA = null;
}

// Advance ANTIC by one animation frame. Sets anticHalt (CPU pauses while true).
function anticUpdate() {
  if (nmiFlash > 0) nmiFlash--;
  if (!anticLive) { anticHalt = false; anticDMA = null; return; }
  if (anticIdle > 0) { anticIdle--; anticHalt = false; return; }     // vertical blank: CPU runs free

  if (anticDMA) {
    anticDMA.elapsed++;
    if (anticDMA.elapsed >= anticDMA.frames) {
      anticPaintRow(anticDMA.row);
      anticScan = (anticScan + anticCols) & 0xffff;
      anticRowOut++;
      anticDP = (anticDP + anticCurLen) & 0xffff;
      anticDMA = null; anticCooldown = ANTIC_LINE_COOLDOWN;
    }
    anticHalt = !!anticDMA;
    return;
  }
  if (anticCooldown > 0) { anticCooldown--; anticHalt = false; return; }

  const b = mem[anticDP];
  if ((b & 0x0f) === 0) {                       // blank-line instruction ($70, $00, ...)
    anticDP = (anticDP + 1) & 0xffff;
    anticHalt = false;
  } else if (b === 0x41) {                      // JVB: end of frame -> vertical blank
    anticFrames++; nmiFlash = 22; anticIdle = anticVBlankFrames();
    anticFrameStart();
    anticHalt = false;
  } else if (b === 0x01) {                      // JMP within the display list
    anticDP = (mem[(anticDP + 1) & 0xffff] | (mem[(anticDP + 2) & 0xffff] << 8)) & 0xffff;
    anticHalt = false;
  } else {                                      // mode line (low nibble 2..15)
    const lms = (b & 0x40) !== 0;
    anticCurLen = lms ? 3 : 1;
    if (lms) anticScan = (mem[(anticDP + 1) & 0xffff] | (mem[(anticDP + 2) & 0xffff] << 8)) & 0xffff;
    const path = anticDataPath();
    const segs = []; let total = 0;
    for (let i = 1; i < path.length; i++) {
      const dd = dist(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
      segs.push(dd); total += dd;
    }
    anticDMA = {
      path, segs, total, frames: anticDMAFrames(), elapsed: 0,
      row: anticRowOut, value: mem[anticScan & 0xffff], addr: anticScan & 0xffff,
    };
    anticHalt = true;
  }
}
