// xlsx-mini.js
// Uses browser's native DecompressionStream (Chrome 80+) for DEFLATE.
// Fully async. Call: await XLSXMini.parseXLSX(arrayBuffer)

(function(global) {
"use strict";

// ── Inflate via DecompressionStream ─────────────────────────────────────────
async function inflate(uint8array) {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  
  writer.write(uint8array);
  writer.close();
  
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { result.set(c, off); off += c.length; }
  return result;
}

// ── ZIP reader ───────────────────────────────────────────────────────────────
async function readZip(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const files = {};

  // Find End of Central Directory record
  let eocd = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (data[i]===0x50 && data[i+1]===0x4b && data[i+2]===0x05 && data[i+3]===0x06) {
      eocd = i; break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid ZIP/XLSX file");

  const cdOffset  = view.getUint32(eocd + 16, true);
  const cdEntries = view.getUint16(eocd + 8,  true);

  let pos = cdOffset;
  for (let e = 0; e < cdEntries; e++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;

    const method     = view.getUint16(pos + 10, true);
    const compSize   = view.getUint32(pos + 20, true);
    const nameLen    = view.getUint16(pos + 28, true);
    const extraLen   = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOff   = view.getUint32(pos + 42, true);
    const name       = new TextDecoder().decode(data.slice(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;

    // Read local file header to find actual data offset
    const lnl = view.getUint16(localOff + 26, true);
    const lxl = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lnl + lxl;
    const raw = data.slice(dataStart, dataStart + compSize);

    if (method === 0) {
      files[name] = raw; // stored, no compression
    } else if (method === 8) {
      files[name] = await inflate(raw); // deflate
    }
    // ignore other methods
  }
  return files;
}

function getText(files, name) {
  const bytes = files[name];
  if (!bytes) return null;
  return new TextDecoder("utf-8").decode(bytes);
}

// ── Parse shared strings ─────────────────────────────────────────────────────
function parseSharedStrings(xml) {
  const strings = [];
  if (!xml) return strings;
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const tRe = /<t[^>]*>([^<]*)<\/t>/g;
    let tm, parts = [];
    while ((tm = tRe.exec(m[1])) !== null) parts.push(tm[1]);
    strings.push(parts.join(""));
  }
  return strings;
}

// ── Parse worksheet ──────────────────────────────────────────────────────────
function parseSheet(xml, sharedStrings) {
  const cells = {};
  const re = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const refM = attrs.match(/\br="([^"]+)"/);
    if (!refM) continue;
    const ref   = refM[1];
    const typeM = attrs.match(/\bt="([^"]+)"/);
    const type  = typeM ? typeM[1] : "n";
    const vM    = inner.match(/<v>([^<]*)<\/v>/);
    const isM   = inner.match(/<is>[\s\S]*?<t[^>]*>([^<]*)<\/t>/);
    let val = "";
    if (vM) {
      val = (type === "s") ? (sharedStrings[parseInt(vM[1], 10)] ?? "") : vM[1];
    } else if (isM) {
      val = isM[1];
    }
    cells[ref] = val;
  }
  return cells;
}

// ── Public API ───────────────────────────────────────────────────────────────
async function parseXLSX(arrayBuffer) {
  const files = await readZip(arrayBuffer);
  const ss    = parseSharedStrings(getText(files, "xl/sharedStrings.xml"));
  const sxml  = getText(files, "xl/worksheets/sheet1.xml");
  if (!sxml) throw new Error("sheet1.xml not found in xlsx");
  return parseSheet(sxml, ss);
}

global.XLSXMini = { parseXLSX };
})(window);
