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
    name: 'Hello World (Atari port)',
    src: `; ---- ported from a MADS "Hello World" ----
; Instead of a hardcoded screen address, it asks
; the OS shadow register SAVMSC where the screen
; is, builds a zero-page pointer, and copies the
; string through it with (ptr),Y. The .byte "..."
; string is auto-converted to Atari screen codes.
SAVMSC = $58          ; OS shadow: screen-memory pointer
ptr    = $80          ; our zero-page pointer
        *=$0600
        LDA SAVMSC    ; screen address, low byte
        STA ptr
        LDA SAVMSC+1  ; screen address, high byte
        STA ptr+1
        LDY #$00
copy    LDA text,Y    ; next character (screen code)
        CMP #$9B      ; Atari end-of-line = end marker
        BEQ done
        STA (ptr),Y   ; store it through the pointer
        INY
        BNE copy
done    BRK           ; ANTIC keeps displaying

text    .byte "Hello World!",$9B
`,
  },
];

let currentDemoSrc = DEMOS[0].src;
let currentDemoName = DEMOS[0].name;

function setDemo(i) {
  currentDemoSrc = DEMOS[i].src;
  currentDemoName = DEMOS[i].name;
}
