// --- 6502 opcode table (the subset this simulator understands) ----------------
// Each entry: [mnemonic, addressing-mode, opcode-byte]
// Modes: imp (implied), imm (#immediate), zp (zero page), abs (absolute),
//        absx (absolute,X), absy (absolute,Y), rel (relative branch)
const OPTABLE = [
  ['LDA','imm',0xA9], ['LDA','zp',0xA5], ['LDA','abs',0xAD], ['LDA','absx',0xBD], ['LDA','absy',0xB9],
  ['LDX','imm',0xA2], ['LDX','zp',0xA6], ['LDX','abs',0xAE], ['LDX','absy',0xBE],
  ['LDY','imm',0xA0], ['LDY','zp',0xA4], ['LDY','abs',0xAC], ['LDY','absx',0xBC],
  ['STA','zp',0x85],  ['STA','abs',0x8D], ['STA','absx',0x9D], ['STA','absy',0x99],
  ['STX','zp',0x86],  ['STX','abs',0x8E],
  ['STY','zp',0x84],  ['STY','abs',0x8C],
  ['TAX','imp',0xAA], ['TAY','imp',0xA8], ['TXA','imp',0x8A], ['TYA','imp',0x98],
  ['INX','imp',0xE8], ['INY','imp',0xC8], ['DEX','imp',0xCA], ['DEY','imp',0x88],
  ['INC','zp',0xE6],  ['INC','abs',0xEE], ['DEC','zp',0xC6],  ['DEC','abs',0xCE],
  ['ADC','imm',0x69], ['ADC','zp',0x65],  ['ADC','abs',0x6D],
  ['SBC','imm',0xE9], ['SBC','zp',0xE5],  ['SBC','abs',0xED],
  ['CMP','imm',0xC9], ['CMP','zp',0xC5],  ['CMP','abs',0xCD],
  ['CPX','imm',0xE0], ['CPY','imm',0xC0],
  ['AND','imm',0x29], ['ORA','imm',0x09], ['EOR','imm',0x49],
  ['JMP','abs',0x4C], ['JSR','abs',0x20], ['RTS','imp',0x60],
  ['PHA','imp',0x48], ['PLA','imp',0x68],
  ['BNE','rel',0xD0], ['BEQ','rel',0xF0], ['BCC','rel',0x90], ['BCS','rel',0xB0],
  ['BPL','rel',0x10], ['BMI','rel',0x30],
  ['CLC','imp',0x18], ['SEC','imp',0x38], ['CLD','imp',0xD8], ['SED','imp',0xF8],
  ['CLV','imp',0xB8], ['NOP','imp',0xEA], ['BRK','imp',0x00],
];

const MODELEN = { imp: 1, imm: 2, zp: 2, abs: 3, absx: 3, absy: 3, rel: 2 };
const BRANCHES = ['BNE','BEQ','BCC','BCS','BPL','BMI'];

// mnemonic+"/"+mode -> opcode   (for the assembler)
const OPENC = {};
// opcode -> {mnemonic, mode, len}   (for the CPU)
const OPDECODE = {};
for (const [m, mode, op] of OPTABLE) {
  OPENC[m + '/' + mode] = op;
  OPDECODE[op] = { mnemonic: m, mode, len: MODELEN[mode] };
}
