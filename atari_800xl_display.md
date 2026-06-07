# Atari 800XL — Display List a zobrazování (souhrn pro emulátor)

To, co je v lidové řeči "jazyk pro nastavení grafického režimu", **není programovací jazyk**, ale datová struktura zvaná **Display List (DL)** — posloupnost bajtů v RAM, kterou čte grafický čip **ANTIC** a podle ní skládá obraz scanline po scanline.

## Architektura — kdo co dělá

- **ANTIC** — samostatný DMA koprocesor. Nezávisle na CPU (6502) čte z RAM Display List i obrazová data. Je to "motor" zobrazování.
- **GTIA** (u 800XL; starší stroje měly CTIA) — bere data z ANTICu a generuje barvy + video signál pro TV.
- **CPU (6502)** — jen zapisuje data do RAM. O překreslování se nestará.

Tok dat:

```
RAM (screen memory) --> ANTIC (řízený Display Listem) --> GTIA --> TV
```

"Automatické propisování do TV", co sis pamatoval: zapíšeš bajt do screen memory a ANTIC ho při dalším snímku sám přečte a zobrazí. DMA běží pořád, 50x/s (PAL) / 60x/s (NTSC). Žádné explicitní "flush" neděláš.

## Display List — instrukce (bajty)

Každý bajt DL je jedna instrukce. Význam bitů:

| Bity | Význam |
|------|--------|
| bity 0-3 (dolní nibble) | režim / typ instrukce (0-15) |
| bit 4 ($10) | horizontální scroll |
| bit 5 ($20) | vertikální scroll |
| bit 6 ($40) | **LMS** — Load Memory Scan (následují 2 bajty s adresou video paměti) |
| bit 7 ($80) | **DLI** — Display List Interrupt (vyvolá přerušení na tom řádku) |

### Typy instrukcí

- **Blank lines (prázdné černé řádky):** dolní nibble = 0, horní 3 bity = počet prázdných scanlinů (0-7, tj. 1-8 řádků).
  - `112` = `$70` = 8 prázdných scanlinů. Standardní DL začíná třemi takovými ($70 $70 $70) = 24 řádků nahoře, aby obraz odsedl od okraje.
- **Mode lines (grafický/textový režim):** dolní nibble 2-15.
  - `2` = ANTIC mode 2 = textový režim 40x24 (v BASICu GRAPHICS 0)
  - `6`, `7` = velké barevné textové režimy (GR.1, GR.2)
  - `8`-`15` = bitmapové grafické režimy (různá rozlišení a počty barev)
- **JMP / JVB (skok):**
  - `$01` = JMP — skok na jinou adresu v rámci DL (následují 2 bajty adresy)
  - `$41` = JVB — Jump and wait for Vertical Blank — typicky na konci DL, skočí zpět na začátek a počká na VBLANK (následují 2 bajty adresy začátku DL)

### LMS detailně

LMS (bit 6) se připojí k mode line, např. `$42` = mode 2 + LMS. Za bajtem následují 2 bajty (lo, hi) = adresa, odkud ANTIC bere obrazová data. První mode line v DL skoro vždy má LMS, aby se nastavila počáteční adresa screen memory. Pokud data přesáhnou hranici 4 KB, musí se LMS zopakovat (ANTIC sám přes 4 KB nepřekročí).

## Klíčové adresy (shadow registry v RAM + hardware ANTIC)

| Dec | Hex | Název | Význam |
|-----|-----|-------|--------|
| 560 / 561 | $0230 / $0231 | **SDLSTL / SDLSTH** | OS shadow: ukazatel na začátek Display Listu (lo/hi) |
| 88 / 89 | $0058 / $0059 | **SAVMSC** | ukazatel na začátek screen memory (obrazové paměti) |
| 559 | $022F | **SDMCTL** | shadow DMACTL — zapíná DMA ANTICu (bez toho ANTIC nekreslí); nastavuje šířku obrazu, DL DMA, P/M DMA |
| 512 / 513 | $0200 / $0201 | **VDSLST** | vektor na rutinu Display List Interruptu (DLI) |
| 54272 / 54273 | $D402 / $D403 | **DLISTL / DLISTH** (ANTIC reg.) | hardwarový registr ANTICu s adresou DL (do něj OS kopíruje z SDLSTL/H) |
| 54400 | $D400 | **DMACTL** (ANTIC reg.) | hardwarový registr DMA control |
| 53248+ | $D000+ | GTIA registry | barvy, kolize, player/missile |
| 712 | $02C8 | **COLBK** (shadow) | barva pozadí / okraje |
| 708-711 | $02C4-$02C7 | **COLPF0-3** (shadow) | barvy playfield |

Pozn.: OS při VBLANK kopíruje shadow registry (560/561, 559, barvy...) do skutečných hardwarových registrů ANTIC/GTIA. Proto se v praxi zapisuje do shadow adres.

## Příklad: standardní Display List pro GRAPHICS 0 (text 40x24)

```
$70 $70 $70        ; 3x 8 prázdných scanlinů (24 řádků nahoře)
$42 <lo> <hi>      ; mode 2 + LMS, adresa screen memory (1. řádek)
$02                ; mode 2 (2. řádek)
$02                ; ... celkem 24x mode 2
... (22x $02) ...
$02                ; 24. řádek
$41 <lo> <hi>      ; JVB — skok zpět na začátek DL + čekej na VBLANK
```

24 řádků textu po 8 scanlinech = 192 scanlinů viditelné oblasti.

## Minimální model pro emulátor

1. Drž ukazatel na DL (z 560/561).
2. ANTIC čte DL bajt po bajtu:
   - blank line -> vygeneruj N prázdných scanlinů
   - mode line -> vygeneruj odpovídající počet scanlinů daného režimu, data ber z aktuální screen-memory adresy (nastavené posledním LMS), adresu po každém řádku posouvej
   - LMS bit -> přečti následující 2 bajty, nastav jimi screen-memory adresu
   - JVB ($41) -> konec rámce, skoč na adresu, čekej na VBLANK
3. Po VBLANK začni znovu od začátku DL.
4. (Volitelně) na mode line s bitem 7 ($80) vyvolej DLI přes vektor VDSLST.

## Pojmy v kostce

- **Display List (DL)** — program/seznam pro ANTIC, jak složit obraz
- **ANTIC** — DMA grafický koprocesor čtoucí DL a data
- **GTIA/CTIA** — generuje barvy a video signál
- **LMS** — Load Memory Scan, nastaví odkud číst pixely/znaky
- **DLI** — Display List Interrupt, přerušení na konkrétním řádku (mid-screen změny barev apod.)
- **JVB** — Jump and Wait for Vertical Blank, konec DL
- **VBLANK** — vertikální zatemnění mezi snímky, bezpečné okno pro změny
- **Screen memory** — oblast RAM s obrazovými daty (znaky/pixely)
- **Shadow registry** — kopie hw registrů v RAM, OS je při VBLANK propisuje do ANTIC/GTIA
