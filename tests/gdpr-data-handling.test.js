'use strict';
// GDPR guardrail tests — these assert the data-minimization invariants documented
// in CLAUDE.md ("GDPR Data Handling"). They scan the shipped source files so a
// regression (e.g. re-adding on-disk run history, or seeding queue state into
// page-origin sessionStorage) fails CI instead of relying on a human reading the docs.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Shipped top-level source files (readdirSync is non-recursive, so tests/ and
// node_modules/ are excluded automatically).
const SOURCE_FILES = fs
  .readdirSync(ROOT)
  .filter((f) => f.endsWith('.js'))
  .sort();

// Remove block and line comments so commentary like "// was sessionStorage.removeItem"
// doesn't trip the bans. The negative check on ':' keeps URLs like https:// intact.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readCode(file) {
  return stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

describe('GDPR: no persistent on-disk candidate data', () => {
  it('run-history.js is not present in the repo', () => {
    assert.ok(
      !fs.existsSync(path.join(ROOT, 'run-history.js')),
      'run-history.js was reintroduced — it persisted run records to IndexedDB. ' +
        'Keep run history in chrome.storage.session (in-memory) instead.'
    );
  });

  it('no source file uses IndexedDB', () => {
    for (const file of SOURCE_FILES) {
      assert.ok(
        !/indexedDB/i.test(readCode(file)),
        `${file} references IndexedDB — no persistent on-disk run/candidate storage allowed.`
      );
    }
  });

  it('no source file references run history', () => {
    for (const file of SOURCE_FILES) {
      assert.ok(
        !/run[-_]?history/i.test(readCode(file)),
        `${file} references run history — the persistent run-history module was removed for GDPR.`
      );
    }
  });
});

describe('GDPR: queue state stays in extension-isolated session storage', () => {
  it('no source file uses raw page-origin sessionStorage', () => {
    for (const file of SOURCE_FILES) {
      assert.ok(
        !/\bsessionStorage\b/.test(readCode(file)),
        `${file} uses raw sessionStorage — queue state must go through chrome.storage.session ` +
          'via the __srSession* shim (extension-isolated, not readable by the SmartRecruiters page).'
      );
    }
  });

  it('storage-session-shim.js defines the __srSession* globals', () => {
    const shim = readCode('storage-session-shim.js');
    for (const fn of ['__srSessionGet', '__srSessionSet', '__srSessionRemove']) {
      assert.ok(shim.includes(fn), `storage-session-shim.js is missing ${fn}`);
    }
  });

  it('background widens session-storage access so content scripts can use it', () => {
    const bg = readCode('background.js');
    assert.ok(
      bg.includes('setAccessLevel') && /TRUSTED_AND_UNTRUSTED_CONTEXTS/.test(bg),
      'background.js must call chrome.storage.session.setAccessLevel(' +
        '{ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }) — without it the *-autorun.js ' +
        'content scripts cannot read the queue and runs silently never resume.'
    );
  });
});
