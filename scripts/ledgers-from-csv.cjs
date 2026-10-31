"use strict";
/* Writes js/ledgers.js from the ledger export CSV.
 *
 *   node scripts/ledgers-from-csv.cjs path/to/ledgers.csv
 *
 * The CSV has one row per ledger: ledger_number, order_code, character, character_name,
 * character_ledger_number, material_count, then material_N / amount_N pairs. Rows may arrive in any
 * order; each character's ledgers are written in character_ledger_number order and must run 1..n
 * with no gaps.
 *
 * Materials the planner crafts become `costs`. Everything else (mined resources, potions) becomes
 * `other`, which the planner shows on the card but does not schedule. A material this script does
 * not recognise stops the run, so a new item in the game cannot be silently dropped.
 *
 * DISABLED characters ask only for materials the planner does not craft. They are written as
 * commented-out entries so turning one on is a matter of removing it from this list and
 * regenerating.
 *
 * Ledgers past MAX_LEDGER_NUMBER, the ones no player has reached yet, are written commented out, so
 * the data file has them but the page cannot offer them. A ledger's number is the trailing digits
 * of its order code. Raise it and regenerate as players get further. */
const fs = require("fs");
const path = require("path");

const CRAFTABLE = {
  IndustrialBits: "Bits",
  SilicateConcrete: "Concrete",
  VespiumIngots: "Ingots",
  SilicateGlass: "Glass",
  SilicateBricks: "Bricks",
  VespiumPlates: "Plates",
  VespiumRods: "Rods",
  VespiumFrames: "Frames",
  LowGradeGel: "Gel",
  VespiumWire: "Wire",
  ReinforcedConcrete: "Reinforced Concrete",
  Batteries: "Batteries",
};
const OTHER = {
  WorthlessRocks: "Worthless Rocks",
  Vespium: "Vespium",
  Hydracite: "Hydracite",
  Jade: "Jade",
  Scorchium: "Scorchium",
  Ardranite: "Ardranite",
  Azvelite: "Azvelite",
  Tokenium: "Tokenium",
  Ether: "Ether",
  EndurancePotion: "Endurance Potion",
  PowerPotion: "Power Potion",
  PrecisionPotion: "Precision Potion",
  DetectionPotion: "Detection Potion",
};
const DISABLED = new Set(["bertha", "caylris-en-divalone", "eidelaine-eeko", "gerbo", "minalima-lin", "the-ether-hoarder", "the-twins"]);
const MAX_LEDGER_NUMBER = 370;
const QUANTITY = /^(?:\d+(?:\.\d+)?)(?:e\d+)?$/;

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function parse(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());
  const header = lines.shift().split(",");
  const column = name => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`CSV is missing the ${name} column`);
    return index;
  };
  const at = {
    code: column("order_code"),
    name: column("character_name"),
    number: column("character_ledger_number"),
    count: column("material_count"),
  };
  const characters = new Map();
  lines.forEach((line, row) => {
    const cells = line.split(",");
    const name = cells[at.name].trim(), number = Number(cells[at.number]), count = Number(cells[at.count]);
    if (!name || !Number.isInteger(number) || number < 1) throw new Error(`Row ${row + 2}: unreadable character or ledger number`);
    const code = cells[at.code].trim(), codeMatch = code.match(/(\d+)$/);
    if (!codeMatch) throw new Error(`Row ${row + 2}: order code "${code}" has no number`);
    // Past the cutoff the ledger is written commented out. Each character's ledgers rise in number,
    // so this only ever comments out the end of a character's list; a cut that left a listed ledger
    // after a commented-out one fails the check below.
    const unlisted = Number(codeMatch[1]) > MAX_LEDGER_NUMBER;
    const costs = [], other = [];
    for (let n = 1; n <= count; n++) {
      const material = cells[column(`material_${n}`)].trim(), amount = cells[column(`amount_${n}`)].trim();
      if (!QUANTITY.test(amount)) throw new Error(`Row ${row + 2}: ${material} amount "${amount}" is not a quantity`);
      if (CRAFTABLE[material]) costs.push({ item: CRAFTABLE[material], qty: amount });
      else if (OTHER[material]) other.push({ item: OTHER[material], qty: amount });
      else throw new Error(`Row ${row + 2}: unknown material "${material}"`);
    }
    const id = slug(name);
    if (!characters.has(id)) characters.set(id, { ledgerId: id, name, ledgers: [] });
    characters.get(id).ledgers.push({ number, code, costs, other, unlisted });
  });
  return [...characters.values()].sort((a, b) => a.name.localeCompare(b.name)).map(character => {
    character.ledgers.sort((a, b) => a.number - b.number);
    character.ledgers.forEach((ledger, index) => {
      if (ledger.number !== index + 1) throw new Error(`${character.name}: ledger ${index + 1} is missing`);
    });
    const firstUnlisted = character.ledgers.findIndex(ledger => ledger.unlisted);
    if (firstUnlisted >= 0 && character.ledgers.slice(firstUnlisted).some(ledger => !ledger.unlisted))
      throw new Error(`${character.name}: ledger ${firstUnlisted + 1} is past the cutoff but a later one is not`);
    return character;
  });
}

const costList = list => "[" + list.map(c => `{item:${JSON.stringify(c.item)},qty:${JSON.stringify(c.qty)}}`).join(",") + "]";

function render(characters) {
  const out = [];
  characters.forEach(character => {
    const prefix = DISABLED.has(character.ledgerId) ? "  // " : "  ";
    out.push(`${prefix}{ledgerId:${JSON.stringify(character.ledgerId)},name:${JSON.stringify(character.name)},` +
      `portrait:"assets/ledger-${character.ledgerId}.webp",ledgers:[`);
    character.ledgers.forEach(ledger => {
      const line = `{code:${JSON.stringify(ledger.code)},costs:${costList(ledger.costs)},other:${costList(ledger.other)}},`;
      out.push(ledger.unlisted && prefix === "  " ? `    // ${line}` : `${prefix}  ${line}`);
    });
    out.push(`${prefix}]},`);
  });
  return `"use strict";
/* ============================================================================
 * LEDGER_CHARACTERS — the characters who post ledgers on the game's Exchange,
 * and every ledger each one asks for, in the order the game opens them.
 *
 * GENERATED by scripts/ledgers-from-csv.cjs from the ledger export CSV:
 *
 *   node scripts/ledgers-from-csv.cjs path/to/ledgers.csv
 *
 * Regenerate rather than editing by hand. Ledger n of a character is ledgers[n-1].
 * \`costs\` are the craftables the planner schedules; \`other\` are mined resources
 * and potions, shown on the ledger card but not planned. Characters whose
 * ledgers ask for no craftables are commented out; the script's DISABLED list
 * names them. Ledgers past the script's MAX_LEDGER_NUMBER are commented out
 * too, until players reach them.
 * ========================================================================== */
const LEDGER_CHARACTERS=[
${out.join("\n")}
];
`;
}

if (require.main === module) {
  const csv = process.argv[2];
  if (!csv) {
    process.stderr.write("usage: node scripts/ledgers-from-csv.cjs path/to/ledgers.csv\n");
    process.exit(2);
  }
  const characters = parse(fs.readFileSync(csv, "utf8"));
  const target = path.join(__dirname, "..", "js", "ledgers.js");
  fs.writeFileSync(target, render(characters));
  const enabled = characters.filter(c => !DISABLED.has(c.ledgerId));
  process.stdout.write(`Wrote ${target}: ${enabled.length} characters on, ${characters.length - enabled.length} commented out, ` +
    `${characters.reduce((sum, c) => sum + c.ledgers.length, 0)} ledgers, ` +
    `${characters.reduce((sum, c) => sum + c.ledgers.filter(l => l.unlisted).length, 0)} past #${MAX_LEDGER_NUMBER} commented out\n`);
}

module.exports = { parse, render, CRAFTABLE, OTHER, DISABLED, MAX_LEDGER_NUMBER };
