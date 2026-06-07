# 6502C "Sally" — Visual Simulator

p5.js vizualizace vnitřku 8-bitového CPU **MOS Technology 6502C "Sally"** z Atari 800XL.
Bílé pozadí, černá drátová grafika — v duchu legendárního **MECC 6502 Simulatoru (1982)**.

Po sběrnici mezi bloky CPU (registry, ALU, paměť) běhá **tečka**, která ukazuje aktuální
přenos dat. Vlevo je ASM demo kód, který se krok po kroku interpretuje; aktuální řádek
se zvýrazní a hodnoty v registrech / RAM se mění přesně v okamžiku, kdy tam tečka dorazí.

## Spuštění

Stačí otevřít **`index.html`** v prohlížeči (dvojklik). Žádný build ani server není potřeba.
p5.js se načítá z CDN, takže při prvním spuštění je třeba připojení k internetu.

## Ovládání

- **program** — výběr demo programu z nabídky
- **RUN** — automatický běh
- **PAUSE** — pozastavit
- **STEP** — jeden krok (jedna instrukce)
- **RESET** — návrat na začátek
- **speed** — rychlost běhající tečky (každý krok trvá stejně dlouho bez ohledu
  na délku drátku; pomalu = nejnázornější, doprava = turbo)
- **ANTIC live** — zapne/vypne video koprocesor (viz níže)
- **turbo (no animation)** — vypne animaci tečky; CPU jede naplno (mnoho instrukcí
  za snímek) a ANTIC jen překresluje video paměť. Pro programy se smyčkami (blikání).

## ANTIC — video koprocesor (hvězda Atari)

Na Atari není hvězdou procesor, ale **custom čipy**. ANTIC je samostatný DMA
koprocesor, který se řídí **Display Listem** (program v RAM) a kreslí obraz.
Když je zaškrtnuto **ANTIC live**, běží autenticky v **textovém režimu**:

- OS přednastaví **Display List** (`$0700`) a obrazovou paměť (`$1000`, textové
  pole 20×4). ANTIC každý snímek prochází DL (`blank` → `mode 2 + LMS` → `JVB`).
- Pro každý textový řádek si **přes DMA přečte z obrazové paměti kódy znaků** a
  podle nich vyhledá glyfy ve **skutečném atari fontu** (`STANDARD`) — na malé **TV**
  se vykreslí text. **CPU jen zapisuje znaky do `$1000`; ANTIC je sám zobrazí**
  (žádný „flush"), takže písmenka naskakují, jak je program píše.
- Při DMA si **krátce půjčí sběrnici** a **zastaví 6502C „Sally"** (rozsvítí se pin
  **HALT**, tečka CPU zamrzne). „Cycle-stealing" je doslova důvod, proč mělo Atari
  vlastní 6502 s HALT pinem.
- Po snímku ANTIC **ťukne na CPU přes NMI** (VBLANK, rozsvítí pin **NMI**) a chvíli
  **odpočívá** — CPU mezitím běží volně. Vše respektuje posuvník rychlosti.

## Demo programy (k načtení z nabídky)

1. **Hello World (ANTIC text)** — CPU kopíruje znaky do obrazové paměti
   (`LDA msg,X` / `STA $1000,X` / `INX` / `CPX` / `BNE`); ANTIC je zobrazí fontem.
2. **Running total (loop)** — smyčka, `ADC`, `STA`, `DEX`, `BNE`.
3. **16-bit add (carry ripple)** — 8-bitový součet nastaví **Carry**, který se pak
   přičte do horního bajtu. Názorná ukázka přenosu.
4. **BCD decimal add** — `SED` zapne decimal režim; `48 + 59 = 107` → `$07` s Carry.
5. **Compare & branch** — `INX` / `CPX` / `BNE`; porovnání nastavuje Carry a Zero.
6. **Poke Atari hardware** — zápis do `$Dxxx` jde přes adresové dekódování do
   **paměťově mapovaných čipů** (GTIA / POKEY / PIA), které se přitom **rozsvítí**.
7. **Hello World (inverse blink)** — port reálného MADS programu: adresu obrazovky
   si **vyzvedne ze stínového registru SAVMSC** (ne natvrdo), postaví zero‑page
   ukazatel a kopíruje řetězec přes `(ptr),Y` (`.byte "Hello World!"` se automaticky
   převede na screen codes). Pak **nekonečně bliká** — čeká, XORne každý znak `$80`
   (přepne **inverzní video**), opakuje. Nejlépe se zaškrtnutým **turbo**.
8. **Square (GR.8 graphics)** — program si **nainstaluje vlastní grafický Display
   List** (ANTIC **mode F**, 1 bit/pixel) a nakreslí do bitmapy obrys čtverce
   (1 bajt = 8 pixelů). Stejná RAM, jiný DL = místo textu grafika. Nejlépe v **turbu**.

Vlastní programy lze přidat do pole `DEMOS` v `js/program.js`.

## Architektura na obrazovce

Rozložení zleva doprava:

```
ASM panel | CPU pouzdro | ADRESOVÁ+DATOVÁ sběrnice | čipy | TV | DISPLAY LIST | VRAM | RAM
```

- **CPU pouzdro** — registry A/X/Y/SP/PC/IR/ALU + stavový registr P s vlajkami
  N V B D I Z **C**, řídicí/přerušovací piny φ2, R/W, HALT, IRQ, NMI, RES.
- **Sběrnice** — adresová (16b) a datová (8b); po nich běhají tečky (■ adresa, ● data).
- **Paměťově mapované čipy** — RAM / OS ROM / ANTIC-GTIA / POKEY-PIA; podle adresy
  se rozsvítí to zařízení, které „odpovídá" (adresové dekódování).
- **TV** — co ANTIC vykresluje (textový režim přes font).
- **DISPLAY LIST** — disassembler ANTICova programu (adresa · bajty · význam) se
  **živým zvýrazněním** právě prováděného řádku a adresou, ze které ANTIC čte.
- **VRAM** — statické kukátko do obrazové paměti (`$1000`) se znakovým sloupcem;
  vidíš, jak ho program plní.
- **RAM** — kukátko do paměti, které **sleduje poslední přístup** (skáče podle čtení/zápisu).

Dvě kukátka = dva pohledy do téže 64 KB RAM: jedno fixní na VRAM, druhé dynamické.

## Struktura

| Soubor | Obsah |
|---|---|
| `js/util.js` | hex/bin formátování |
| `js/opcodes.js` | tabulka opkódů podporované podmnožiny 6502 |
| `js/program.js` | demo programy (`DEMOS`) |
| `js/assembler.js` | dvouprůchodový assembler (`*=`, `.byte`, labely) → strojový kód |
| `js/cpu.js` | stav CPU + interpret generující „mikrokroky" pro animaci |
| `js/anticfont.js` | atari font (128 glyfů) vygenerovaný z `STANDARD.png` |
| `js/antic.js` | ANTIC: interpret Display Listu, textový režim, DMA/HALT |
| `js/layout.js` | geometrie schématu + vykreslování (vč. TV) |
| `js/sketch.js` | p5 smyčka, stavový automat krokování/běhu, animace teček |

## Podporované instrukce

Loads/stores (LDA/LDX/LDY, STA/STX/STY), přesuny (TAX/TAY/TXA/TYA),
inkrementy/dekrementy (INX/INY/DEX/DEY, INC/DEC), aritmetika a logika
(ADC/SBC, AND/ORA/EOR), porovnání (CMP/CPX/CPY), skoky a větvení
(JMP/JSR/RTS, BNE/BEQ/BCC/BCS/BPL/BMI), zásobník (PHA/PLA),
příznaky (CLC/SEC/CLD/SED/CLV), NOP, BRK.

Adresovací režimy: immediate, zero page, absolute, **absolute,X / absolute,Y**,
**(zp),Y nepřímé indexované**, relative. Aritmetika ADC/SBC podporuje i
**decimal (BCD) režim** (SED/CLD).

Assembler umí: `*=` origin, labely, **`NAME = value` equates**, **`label+N` aritmetiku**
a direktivu **`.byte`** — buď čísla, nebo **`"řetězec"`, který se automaticky převede
na atari screen codes** (proto se text zobrazí správně, ne posunutý jako ATASCII).

(Není cyklově přesné — jde o názornou výukovou vizualizaci, stejně jako originál MECC.)

## Verifikace / testy

- `node test/logic.js` — logické testy jádra (assembler, `abs,X`/`.byte`, BCD/binární
  ADC-SBC, entry point, všechna demíčka end-to-end). Běží bez prohlížeče.
- `node test/shoot.js` — headless test v prohlížeči přes Playwright: chyby v konzoli,
  reakce ANTICu na rychlost, render textu fontem, CPU→ANTIC pipeline, „latch" IR,
  finální stav, dekódování čipů. (Vyžaduje `npm install playwright` + Chrome.)
- `node test/buildfont.js` — (build) přegeneruje `js/anticfont.js` z PNG fontu.

## Inspirace

MECC 6502 Simulator (1982), součást balíku „Apple Assembly Language".
Viz video Tea Leaves: <https://www.youtube.com/watch?v=aZvss4XnceU>
