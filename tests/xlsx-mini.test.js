'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// xlsx-mini attaches to window in the browser, globalThis in Node.
require('../xlsx-mini.js');
const { parseXLSX } = globalThis.XLSXMini;

// ── Minimal ZIP builder (stored entries only, method 0 — no compression) ────
// Just enough of the ZIP format for readZip(): local headers, central
// directory, EOCD. CRCs are zeroed (xlsx-mini does not verify them).
function makeZip(entries) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, text] of Object.entries(entries)) {
    const nameB = encoder.encode(name);
    const dataB = encoder.encode(text);

    const local = new Uint8Array(30 + nameB.length + dataB.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // local file header signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(8, 0, true);            // method 0 = stored
    lv.setUint32(18, dataB.length, true); // compressed size
    lv.setUint32(22, dataB.length, true); // uncompressed size
    lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    local.set(dataB, 30 + nameB.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameB.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);   // central directory signature
    cv.setUint16(10, 0, true);           // method 0 = stored
    cv.setUint32(20, dataB.length, true); // compressed size
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);      // local header offset
    central.set(nameB, 46);
    centrals.push(central);

    offset += local.length;
  }

  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);     // EOCD signature
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);        // central directory offset

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out.buffer;
}

// ── Fixture workbook: 2 sheets, names out of order vs file numbering ────────
// "Data" (the sheet callers want) lives in sheet2.xml, like the real fitments
// workbook where "External" is not the first worksheet file.
function fixtureXlsx() {
  return makeZip({
    'xl/workbook.xml':
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      '<sheet name="Lists" sheetId="4" r:id="rId1"/>' +
      '<sheet name="Data" sheetId="1" r:id="rId2"/>' +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships>' +
      '<Relationship Id="rId1" Type="…/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="…/worksheet" Target="worksheets/sheet2.xml"/>' +
      '</Relationships>',
    'xl/sharedStrings.xml':
      '<sst><si><t>Basic Salary</t></si><si><r><t>Total </t></r><r><t>Base Pay</t></r></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row r="1"><c r="A1"><v>111</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml':
      '<worksheet><sheetData>' +
      // A16 styled-but-empty (self-closing) directly before a shared-string cell
      '<row r="16"><c r="A16" s="2"/><c r="B16" t="s"><v>0</v></c>' +
      // D16 empty before a formula cell with a cached value
      '<c r="D16" s="7"/><c r="E16" s="23"><f>+IF(D4&gt;1,E22*40%,0)</f><v>1760000</v></c></row>' +
      '<row r="22"><c r="B22" t="s"><v>1</v></c><c r="E22"><v>4400000</v></c>' +
      '<c r="F22" t="inlineStr"><is><t>note</t></is></c></row>' +
      '</sheetData></worksheet>',
  });
}

// ── Fixture: External + Internal tabs, same cell refs, different values ─────
// Mirrors the real fitments workbook, where the two tabs are independent
// calculators: the popup's sheet toggle must read the chosen tab only.
function fixtureTwoTabXlsx() {
  return makeZip({
    'xl/workbook.xml':
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      '<sheet name="External" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Internal" sheetId="2" r:id="rId2"/>' +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships>' +
      '<Relationship Id="rId1" Type="…/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="…/worksheet" Target="worksheets/sheet2.xml"/>' +
      '</Relationships>',
    'xl/sharedStrings.xml':
      '<sst><si><t>HRA</t></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData>' +
      '<row r="18"><c r="B18" t="s"><v>0</v></c><c r="E18"><f>+IF(D4&gt;1,E22*5%,0)</f><v>0</v></c></row>' +
      '</sheetData></worksheet>',
    'xl/worksheets/sheet2.xml':
      '<worksheet><sheetData>' +
      '<row r="18"><c r="B18" t="s"><v>0</v></c><c r="E18"><f>+IF(D4&gt;1,E25*5%,0)</f><v>864000</v></c></row>' +
      '</sheetData></worksheet>',
  });
}

describe('parseXLSX — sheet selection', () => {
  it('defaults to sheet1.xml when no sheet name is given', async () => {
    const cells = await parseXLSX(fixtureXlsx());
    assert.equal(cells.A1, '111');
  });

  it('resolves a named sheet through workbook.xml + rels', async () => {
    const cells = await parseXLSX(fixtureXlsx(), 'Data');
    assert.equal(cells.E22, '4400000');
    assert.equal(cells.A1, undefined);
  });

  it('sheet name matching is case-insensitive', async () => {
    const cells = await parseXLSX(fixtureXlsx(), 'dAtA');
    assert.equal(cells.E22, '4400000');
  });

  it('throws a clear error for a missing sheet name', async () => {
    await assert.rejects(
      parseXLSX(fixtureXlsx(), 'External'),
      /Sheet "External" not found/
    );
  });

  it('External and Internal tabs parse independently (same refs, own values)', async () => {
    const ext = await parseXLSX(fixtureTwoTabXlsx(), 'External');
    const int = await parseXLSX(fixtureTwoTabXlsx(), 'Internal');
    assert.equal(ext.B18, 'HRA');
    assert.equal(int.B18, 'HRA');
    assert.equal(ext.E18, '0');       // untouched External calculator
    assert.equal(int.E18, '864000');  // filled Internal calculator
  });
});

describe('parseXLSX — cell parsing', () => {
  it('self-closing empty cells do not swallow the next cell', async () => {
    // Regression: <c r="A16" s="2"/> used to match as a normal cell and lazily
    // consume up to B16's </c>, so B16 (and E16 after empty D16) vanished.
    const cells = await parseXLSX(fixtureXlsx(), 'Data');
    assert.equal(cells.B16, 'Basic Salary');
    assert.equal(cells.E16, '1760000');
  });

  it('reads cached values of formula cells', async () => {
    const cells = await parseXLSX(fixtureXlsx(), 'Data');
    assert.equal(cells.E16, '1760000');
  });

  it('joins rich-text runs in shared strings', async () => {
    const cells = await parseXLSX(fixtureXlsx(), 'Data');
    assert.equal(cells.B22, 'Total Base Pay');
  });

  it('reads inline strings', async () => {
    const cells = await parseXLSX(fixtureXlsx(), 'Data');
    assert.equal(cells.F22, 'note');
  });
});
