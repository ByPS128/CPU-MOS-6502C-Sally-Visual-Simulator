# CLAUDE.md — guide for working in this repo

p5.js visual simulator of the **MOS 6502C "Sally"** CPU as used in the **Atari 800XL**,
with an authentic **ANTIC** video coprocessor. White background, black wireframe, in the
spirit of the MECC 6502 Simulator (1982). All vanilla JS, no build step for the app.

GitHub: https://github.com/ByPS128/CPU-MOS-6502C-Sally-Visual-Simulator

## Run & test

- **Run the app:** open `index.html` in a browser (double-click; `file://` works). p5.js
  loads from a CDN, so the first load needs internet. No build, no server.
- **Logic tests (fast, no browser):** `node test/logic.js` — assembler, `abs,X`/`.byte`,
  binary + BCD ADC/SBC, entry point, every demo end-to-end. Exits non-zero on failure.
- **Browser tests (headless):** `node test/shoot.js` — uses Playwright + Chrome to load
  the page, capture console errors, and assert: speed slider affects ANTIC, ANTIC renders
  text via the font, CPU→ANTIC pipeline, IR latch, final CPU/RAM state, chip decoding.
  Writes screenshots to `test/*.png`. Requires `npm install playwright` and Chrome.
- **Rebuild the font (rare):** `node test/buildfont.js` — regenerates `js/anticfont.js`
  from the Atari font PNG (decodes via Chrome canvas).

**Always run BOTH `test/logic.js` and `test/shoot.js` after changes.** Logic alone is not
enough — bugs here are usually visual/runtime (see gotchas).

## File map (load order matters; see index.html)

util → opcodes → program → assembler → cpu → anticfont → antic → layout → sketch

| File | Role |
|---|---|
| `js/util.js` | `hex2/hex4/bin8` formatting |
| `js/opcodes.js` | opcode table for the supported 6502 subset; `OPENC`/`OPDECODE`, `MODELEN` |
| `js/program.js` | `DEMOS[]` (selectable demo programs), `currentDemoSrc`, `setDemo()` |
| `js/assembler.js` | two-pass assembler: `*=`, labels, `NAME=val` equates, `label+N` math, `.byte` (numbers or a `"string"` auto-converted to Atari screen codes), modes imm/zp/abs/abs,X/abs,Y/(zp),Y/rel |
| `js/cpu.js` | CPU state (`regs`, `mem`, flags) + `execute()` → bus-aware micro-steps |
| `js/anticfont.js` | `ATARI_FONT[128][8]` baked from `STANDARD.png` (generated; committed) |
| `js/antic.js` | ANTIC: walks the Display List, text-mode font render, DMA/HALT/VBLANK |
| `js/layout.js` | geometry + all drawing (schematic, TV, Display List panel, VRAM/RAM) |
| `js/sketch.js` | p5 `setup`/`draw`, step/run state machine, dot animation, controls |
| `test/` | `logic.js`, `shoot.js` (Playwright), `diag.js`, `buildfont.js` |

## How it works

- **CPU:** `execute()` runs one instruction and returns "micro-steps". Each step is one
  data transfer the animated dot performs, tagged `bus`: `addr` (address bus, ■ + $hhhh),
  `data` (data bus, ● + $hh), `internal` (inside CPU), or `none` (a control note). Each
  step's `apply()` commits the state change exactly when the dot arrives. `step.at` carries
  the effective address so the dot routes to the right device (`deviceFor` in layout.js).
- **Animation is time-based:** `stepFrames()` (sketch.js) maps the speed slider to a fixed
  number of frames per step, so long and short wires take the same time. Don't go back to
  px/frame — long CPU↔RAM wires made it crawl.
- **ANTIC:** runs every frame independent of the CPU (`anticUpdate()` in draw()). It walks
  a real Display List in RAM (blank `$70` / mode-2+LMS `$42` / mode-2 `$02` / JVB `$41`),
  DMA-reads character codes from screen memory per text row, and `drawTV` renders them via
  `ATARI_FONT`. `tvCells` holds CHARACTER CODES, not bitmap bytes. While ANTIC's DMA dot
  moves, `anticHalt` is true and the CPU pauses (cycle-stealing → HALT pin lights); at JVB
  it rests (`anticIdle`, VBLANK) and pulses NMI. All ANTIC timing also derives from
  `stepFrames()`.
- **Turbo mode** (`turbo` flag / checkbox): skips all animation — `runInstructionFast()`
  runs `TURBO_BUDGET` whole instructions per frame and `anticPaintAll()` just repaints
  the screen (no DMA dot, no HALT). Needed for loop-heavy programs (e.g. the blink demo).
- **Inverse video:** screen-code bit 7 ($80) = inverse. `drawTV` renders such cells with
  a black background and light glyph. XOR-ing screen bytes with $80 toggles it.
- **Graphics mode:** `anticDecodeDL()` walks the DL and reports text (mode 2) vs graphics
  (mode F, 1bpp). In graphics, 1 byte = 8 pixels and each mode-F line = 1 scanline;
  `drawTV` renders the bitmap. The OS text DL lives at `$0480` so a demo can install its
  own DL at `$0700` (set SDLST) and switch ANTIC into graphics — see the GR.8 square demo.

## Memory map (in the simulated 64 KB `mem`)

| Addr | Use |
|---|---|
| `$0058/$0059` | SAVMSC shadow (screen ptr) — set by `anticReset` |
| `$0230/$0231` | SDLST shadow (display-list ptr) — set by `anticReset` |
| `$0600` | program code (entry point) |
| `$0480` | OS text Display List (laid down by `anticReset`) |
| `$0700` | free for a demo's own Display List (e.g. the GR.8 graphics demo) |
| `$0710..` | demo data / results |
| `$0750` | demo data tables (`.byte`) in the Hello World demo |
| `$1000` | screen memory = "VRAM" (20×4 text); the CPU writes here, ANTIC reads it |
| `$D000-$D7FF` | memory-mapped chips (GTIA/ANTIC/POKEY/PIA) for address decoding |

## Gotchas / conventions (read before editing!)

- **p5 GLOBAL MODE name collisions are the #1 trap.** p5 puts its built-ins on `window`,
  so naming a global function/var after one silently overrides yours (a helper named
  `box()` once broke `draw()` every frame → only wires drew, nothing animated). Avoid p5
  names: `box, line, rect, point, text, fill, stroke, color, image, map, dist, lerp,
  constrain, width, height, frameCount, pixels, key, char, get, set, ...`. Prefix things
  (`drawBox`, `anticDataPath`, `ATARI_FONT`).
- **Verify visually, not just in node.** Most regressions are runtime/visual; `test/shoot.js`
  catches them (console errors + state asserts + screenshots).
- **`drawingContext`** (the canvas 2D ctx) is used for clipping. The ASM panel and the
  Display List panel both clip to their box and **scroll vertically to follow the
  execution pointer** (current ASM line / active DL line), with a `start–end/total`
  indicator — so arbitrarily long source / display lists stay usable.
- **Reset order:** `setup()` and `resetMachine()` call `cpuReset()` (reallocates `mem`,
  assembles the demo) THEN `anticReset()` (lays the DL, clears screen, sets shadow regs).
  Keep that order or ANTIC's setup gets wiped.
- **Geometry** lives in `layout.js` constants (`CW`, `BUS_END`, `RAM_X`, `VR_X`, `TV_X`,
  `DLP_X`, ...). Derived values (`RAM_TAPX`) follow automatically; if you move panels, also
  bump `#app max-width` in `index.html` and the viewport in `test/shoot.js`.
- **ATASCII ≠ screen codes.** ANTIC text mode indexes the font by *internal screen
  code*, not ASCII (internal = ascii − $20 for $20–$7F). Writing raw ASCII to screen
  memory shows shifted/wrong glyphs — the classic Atari beginner bug. The assembler's
  `.byte "string"` does this conversion for you (`atasciiToScreen`); demos that store
  numeric codes use the internal values directly.
- **Not cycle-accurate** — it's a teaching visualization (like the MECC original).
- Git: line-ending warnings (LF→CRLF) on Windows are harmless. `gh` CLI is at
  `C:\Program Files\GitHub CLI\gh.exe` (not always on PATH in a fresh shell).

## Inspiration

MECC 6502 Simulator (1982), part of "Apple Assembly Language". Tea Leaves video:
https://www.youtube.com/watch?v=aZvss4XnceU
