// --- ANTIC: the Atari's video coprocessor, driven by a real Display List ------
// ANTIC is a DMA coprocessor. Every frame it walks a Display List in RAM and, for
// each text (mode 2) line, reads character codes from screen memory and looks
// each one up in the Atari font (ATARI_FONT) to paint the TV. The CPU just writes
// characters into screen memory ($1000) — ANTIC shows them on the next frame
// (no "flush"). While ANTIC reads the bus it HALTs the 6502C "Sally"
// (cycle-stealing); after the last line it rests (vertical blank) and raises NMI,
// letting the CPU run free. All timing follows the speed slider via stepFrames().
//
// Memory map (set up by anticReset, like the Atari OS does for GRAPHICS 0):
//   $0700  Display List        $1000  screen memory (20x4 text)
//   shadow regs: $0230/$0231 = DL ptr,  $0058/$0059 = screen ptr

const ANTIC_DL_BASE = 0x0700;
const ANTIC_SCREEN_BASE = 0x1000;
const ANTIC_COLS = 20;
const ANTIC_ROWS = 4;
const ANTIC_LINE_COOLDOWN = 3;     // frames the CPU runs between scanline DMAs

let anticLive = true;
let anticCols = ANTIC_COLS;
let anticRows = ANTIC_ROWS;
let tvCells = [];                  // length cols*rows: character codes (0 = space)

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

// Lay down a standard GRAPHICS-0-style Display List + clear the text screen.
function anticReset() {
  // Display List at $0700: 24 blank scanlines, mode 2 + LMS -> screen, more mode 2 rows, JVB.
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

  anticCols = ANTIC_COLS; anticRows = ANTIC_ROWS;
  tvCells = new Array(ANTIC_COLS * ANTIC_ROWS).fill(0);
  anticFrameStart();
  anticDMA = null; anticHalt = false; anticCooldown = 0; anticIdle = 0; nmiFlash = 0; anticFrames = 0;
}

function anticFrameStart() {
  anticDP = anticDLStart();
  anticScan = anticScreenStart();
  anticRowOut = 0;
}

// Paint one text row: read cols character codes from screen memory into tvCells.
function anticPaintRow(row) {
  for (let c = 0; c < anticCols; c++) tvCells[row * anticCols + c] = mem[(anticScan + c) & 0xffff];
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
