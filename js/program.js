// --- Demo programs shown in the left-hand ASM panel ---------------------------
// Pick one from the toolbar dropdown. Each is plain 6502 assembly.
// (Atari internal screen codes: space=$00, A=$21 ... Z=$3A; ascii-$20 for $20-$5F.)

const DEMOS = [
  {
    name: 'Hello World (ANTIC text)',
    src: `; ---- ANTIC text mode: HELLO WORLD ----
; The OS already set up a text Display List
; and screen memory at $1000. The CPU just
; copies characters there; ANTIC reads them
; every frame and paints them with the Atari
; font onto the TV. Watch letters appear!
        *=$0600
        LDX #$00
copy    LDA msg,X      ; next character code
        STA $1000,X    ; -> screen memory (row 0)
        INX
        CPX #$0B       ; 11 characters
        BNE copy       ; loop
        BRK            ; ANTIC keeps displaying

        *=$0750
; "HELLO WORLD" in Atari internal codes
msg     .byte $28,$25,$2C,$2C,$2F,$00,$37,$2F,$32,$2C,$24
`,
  },
  {
    name: 'Running total (loop)',
    src: `; ---- running total ----
; Add 3 to A five times, saving the
; total to RAM at $0710.
        *=$0600
start   LDA #$00      ; A = 0
        LDX #$05      ; loop 5 times
loop    CLC           ; clear carry
        ADC #$03      ; A = A + 3
        STA $0710     ; save total -> RAM
        DEX           ; X = X - 1
        BNE loop      ; repeat until X = 0
        BRK           ; halt
`,
  },
  {
    name: '16-bit add (carry ripple)',
    src: `; ---- 16-bit addition ----
; $01FF + $0001 = $0200
; low bytes set CARRY, which then
; ripples into the high byte.
        *=$0600
        CLC           ; start with no carry
        LDA #$FF      ; low byte of $01FF
        ADC #$01      ; +1 -> $00, CARRY set
        STA $0710     ; store low result
        LDA #$01      ; high byte of $01FF
        ADC #$00      ; +0 + CARRY -> $02
        STA $0711     ; store high result
        BRK
`,
  },
  {
    name: 'BCD decimal add',
    src: `; ---- decimal (BCD) mode ----
; In decimal mode 48 + 59 = 107,
; giving $07 with the CARRY set.
        *=$0600
        SED           ; enable decimal mode
        CLC
        LDA #$48      ; 48 (BCD)
        ADC #$59      ; +59 -> $07, CARRY=1
        STA $0710
        CLD           ; back to binary
        BRK
`,
  },
  {
    name: 'Compare & branch',
    src: `; ---- compare and branch ----
; Count X up to 4, using CPX/BNE.
; CMP/CPX set the CARRY and ZERO
; flags without changing A or X.
        *=$0600
        LDX #$00
loop    INX           ; X = X + 1
        STX $0710     ; show progress
        CPX #$04      ; compare X with 4
        BNE loop      ; loop until X = 4
        BRK
`,
  },
  {
    name: 'Poke Atari hardware',
    src: `; ---- memory-mapped I/O ----
; Storing to $Dxxx talks to the
; Atari chips, not RAM. Watch the
; data dot reach GTIA / POKEY / PIA.
        *=$0600
        LDA #$0E
        STA $D01A     ; GTIA: background colour
        LDA #$A0
        STA $D200     ; POKEY: audio frequency
        LDA #$3C
        STA $D301     ; PIA: port A control
        BRK
`,
  },
  {
    name: 'Hello World (inverse blink)',
    src: `; ---- ported from a MADS "Hello World" ----
; Asks SAVMSC where the screen is, copies the
; string there via a pointer, then loops forever:
; wait, flip bit 7 of each char (inverse video),
; repeat -> the text blinks. (Use the turbo box!)
SAVMSC = $58          ; OS shadow: screen-memory pointer
ptr    = $80          ; our zero-page pointer
len    = $82          ; remembered string length
        *=$0600
        LDA SAVMSC    ; screen address, low byte
        STA ptr
        LDA SAVMSC+1  ; screen address, high byte
        STA ptr+1
        LDY #$00
copy    LDA text,Y    ; next character (screen code)
        CMP #$9B      ; Atari end-of-line = end marker
        BEQ setlen    ; end -> Y now holds the length
        STA (ptr),Y   ; store it through the pointer
        INY
        BNE copy
setlen  STY len       ; remember length (no magic constant)
; ---- blink loop (forever) ----
blink   LDX #$60      ; outer delay count
wait    LDY #$00
inner   DEY
        BNE inner     ; inner delay (256x)
        DEX
        BNE wait      ; outer delay
        LDY #$00
flip    LDA (ptr),Y   ; read a character back
        EOR #$80      ; toggle inverse-video bit
        STA (ptr),Y   ; write it back
        INY
        CPY len       ; compare to the stored length
        BNE flip
        JMP blink     ; do it again

text    .byte "Hello World!",$9B
`,
  },
  {
    name: 'Square (GR.8 graphics)',
    src: `; ---- ANTIC graphics mode F (GR.8, 1bpp) ----
; Installs its OWN graphics display list, then draws
; a rectangle outline into the bitmap (1 byte = 8 px).
; Same RAM, different DL = graphics instead of text!
; (Best with the turbo box checked.)
screen = $1000        ; bitmap, 12 bytes per scanline
ptr    = $80
        *=$0600
        LDA #$00      ; point ANTIC at our graphics DL ($0700)
        STA $0230
        LDA #$07
        STA $0231
        LDX #$00      ; clear the bitmap (240 bytes)
        LDA #$00
clr     STA screen,X
        INX
        CPX #$F0
        BNE clr
        LDX #$02      ; top + bottom edges: bytes 2..3 = $FF (16 px wide)
        LDA #$FF
edge    STA screen+24,X    ; row 2  (2*12)
        STA screen+204,X   ; row 17 (17*12)
        INX
        CPX #$04
        BNE edge
        LDA #$24      ; side edges: ptr = $1000 + 36 (row 3)
        STA ptr
        LDA #$10
        STA ptr+1
        LDX #$0E      ; 14 rows (3..16)
side    LDY #$02
        LDA (ptr),Y
        ORA #$80      ; left pixel  (byte 2, bit 7 = x16)
        STA (ptr),Y
        LDY #$03
        LDA (ptr),Y
        ORA #$01      ; right pixel (byte 3, bit 0 = x31)
        STA (ptr),Y
        CLC           ; ptr += 12 (next scanline)
        LDA ptr
        ADC #$0C
        STA ptr
        LDA ptr+1
        ADC #$00
        STA ptr+1
        DEX
        BNE side
        BRK

; graphics display list at $0700: 24 blank, mode F + LMS $1000, more mode F, JVB
        *=$0700
        .byte $70,$70,$70,$4F,$00,$10
        .byte $0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F
        .byte $41,$00,$07
`,
  },
  {
    name: 'Checkerboard (GR.8 graphics)',
    src: `; ---- ANTIC graphics (mode F): checkerboard ----
; Same graphics display list, but the program fills
; the whole bitmap with an 8x8 checkerboard: each row
; toggles $FF/$00 per byte, and the starting value
; flips every 8 rows. (Best with turbo.)
screen = $1000
ptr    = $80
bandv  = $82          ; this row's starting byte ($FF or $00)
bcount = $83          ; rows left until the band flips
        *=$0600
        LDA #$00      ; point ANTIC at our graphics DL ($0700)
        STA $0230
        LDA #$07
        STA $0231
        LDA #$00      ; ptr = screen ($1000)
        STA ptr
        LDA #$10
        STA ptr+1
        LDA #$FF      ; first band starts with $FF
        STA bandv
        LDA #$08
        STA bcount
        LDX #$14      ; 20 scanlines
row     LDA bandv     ; starting byte for this row
        LDY #$00
col     STA (ptr),Y   ; write a byte (8 pixels)
        EOR #$FF      ; alternate $FF / $00 across the row
        INY
        CPY #$0C      ; 12 bytes per row
        BNE col
        CLC           ; ptr += 12 (next scanline)
        LDA ptr
        ADC #$0C
        STA ptr
        LDA ptr+1
        ADC #$00
        STA ptr+1
        DEC bcount    ; flip the band every 8 rows
        BNE same
        LDA bandv
        EOR #$FF
        STA bandv
        LDA #$08
        STA bcount
same    DEX
        BNE row
        BRK

        *=$0700
        .byte $70,$70,$70,$4F,$00,$10
        .byte $0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F
        .byte $41,$00,$07
`,
  },
];

let currentDemoSrc = DEMOS[0].src;
let currentDemoName = DEMOS[0].name;

function setDemo(i) {
  currentDemoSrc = DEMOS[i].src;
  currentDemoName = DEMOS[i].name;
}
