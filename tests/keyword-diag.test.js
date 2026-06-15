'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  capText,
  saveProfileDiag,
  DIAG_KEY_PREFIX,
  DIAG_MAX_ENTRIES,
  DIAG_TEXT_CAP,
  DIAG_SOURCE_CAP,
} = require('../keyword-triage-core.js');
const { resolveKeywordsWithMeta } = require('../keyword-expansions.js');

describe('capText', () => {
  it('returns string under cap unchanged', () => {
    assert.strictEqual(capText('hello world', 100), 'hello world');
  });

  it('truncates over-cap string and appends marker', () => {
    const big = 'x'.repeat(200);
    const out = capText(big, 50);
    assert.ok(out.startsWith('x'.repeat(50)));
    assert.ok(out.includes('[truncated +150 chars]'));
  });

  it('handles null/undefined gracefully', () => {
    assert.strictEqual(capText(null, 10), '');
    assert.strictEqual(capText(undefined, 10), '');
  });

  it('handles non-string by stringifying', () => {
    assert.strictEqual(capText(42, 10), '42');
  });

  it('cap matches exact length', () => {
    const exact = 'a'.repeat(10);
    assert.strictEqual(capText(exact, 10), exact);  // no truncation marker
  });
});

describe('resolveKeywordsWithMeta exposes userKeywordsList', () => {
  it('returns parsed user keywords pre-expansion', () => {
    const meta = resolveKeywordsWithMeta('docker, kubernetes, python');
    assert.ok(Array.isArray(meta.userKeywordsList));
    assert.deepStrictEqual(meta.userKeywordsList, ['docker', 'kubernetes', 'python']);
  });

  it('preserves user casing in userKeywordsList', () => {
    const meta = resolveKeywordsWithMeta('Docker, Kubernetes');
    assert.deepStrictEqual(meta.userKeywordsList, ['Docker', 'Kubernetes']);
  });

  it('applies typo fix before populating userKeywordsList', () => {
    // pytroch -> pytorch via KEYWORD_TYPO_ALIASES
    const meta = resolveKeywordsWithMeta('pytroch');
    assert.deepStrictEqual(meta.userKeywordsList, ['pytorch']);
  });

  it('userKeywordsList is a separate array from keywords', () => {
    const meta = resolveKeywordsWithMeta('pytorch');
    assert.ok(meta.userKeywordsList.length < meta.keywords.length,
      'expansions should add more entries to keywords');
  });
});

describe('saveProfileDiag', () => {
  let storage;
  let originalChrome;

  beforeEach(() => {
    storage = {};
    originalChrome = global.chrome;
    // Minimal chrome.storage.local mock — synchronous-ish (callback fired immediately).
    global.chrome = {
      storage: {
        local: {
          set(payload, cb) {
            Object.assign(storage, payload);
            if (cb) cb();
          },
          get(keys, cb) {
            if (keys === null || keys === undefined) {
              cb(Object.assign({}, storage));
            } else if (Array.isArray(keys)) {
              const out = {};
              for (const k of keys) if (k in storage) out[k] = storage[k];
              cb(out);
            } else {
              const out = {};
              if (keys in storage) out[keys] = storage[keys];
              cb(out);
            }
          },
          remove(keys, cb) {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) delete storage[k];
            if (cb) cb();
          },
        },
      },
      runtime: { lastError: null },
    };
  });

  afterEach(() => {
    global.chrome = originalChrome;
  });

  it('writes entry under lastRunDiag_<timestamp> key', (t, done) => {
    const ts = 1717420800000;
    saveProfileDiag({ timestamp: ts, profileUrl: 'http://example/profile/1', userInput: 'docker' });
    // Pruning runs through nested callbacks — let microtasks flush.
    setImmediate(() => {
      const key = DIAG_KEY_PREFIX + ts;
      assert.ok(key in storage, 'expected key ' + key);
      assert.strictEqual(storage[key].profileUrl, 'http://example/profile/1');
      done();
    });
  });

  it('prunes to DIAG_MAX_ENTRIES most recent entries', (t, done) => {
    // Pre-populate with DIAG_MAX_ENTRIES + 5 older entries.
    for (let i = 0; i < DIAG_MAX_ENTRIES + 5; i++) {
      const ts = 1000 + i;  // strictly increasing
      storage[DIAG_KEY_PREFIX + ts] = { timestamp: ts };
    }
    // Save one more (newest). Should leave only DIAG_MAX_ENTRIES total.
    const newest = 2000;
    saveProfileDiag({ timestamp: newest });
    setImmediate(() => {
      setImmediate(() => {
        const remaining = Object.keys(storage).filter(k => k.indexOf(DIAG_KEY_PREFIX) === 0);
        assert.strictEqual(remaining.length, DIAG_MAX_ENTRIES,
          'expected exactly ' + DIAG_MAX_ENTRIES + ' entries after prune, got ' + remaining.length);
        assert.ok(remaining.includes(DIAG_KEY_PREFIX + newest), 'newest must survive prune');
        // Oldest two (1000, 1001) should be deleted (we had 25 + 1 new = 26, kept 20 newest).
        assert.ok(!remaining.includes(DIAG_KEY_PREFIX + 1000));
        assert.ok(!remaining.includes(DIAG_KEY_PREFIX + 1001));
        done();
      });
    });
  });

  it('silently no-ops when chrome.storage is undefined', () => {
    global.chrome = undefined;
    // Must not throw.
    assert.doesNotThrow(() => saveProfileDiag({ timestamp: Date.now() }));
  });

  it('preserves non-diag keys during prune', (t, done) => {
    storage['keywordTriageLastRun'] = { foo: 'bar' };
    storage['unrelatedSetting'] = 42;
    for (let i = 0; i < DIAG_MAX_ENTRIES + 3; i++) {
      storage[DIAG_KEY_PREFIX + (1000 + i)] = { timestamp: 1000 + i };
    }
    saveProfileDiag({ timestamp: 9999 });
    setImmediate(() => {
      setImmediate(() => {
        assert.strictEqual(storage['keywordTriageLastRun'].foo, 'bar', 'unrelated key must survive');
        assert.strictEqual(storage['unrelatedSetting'], 42);
        done();
      });
    });
  });
});

describe('cap constants are sensible', () => {
  it('DIAG_TEXT_CAP is at least 10 KB', () => {
    assert.ok(DIAG_TEXT_CAP >= 10 * 1024);
  });
  it('DIAG_SOURCE_CAP is smaller than DIAG_TEXT_CAP', () => {
    assert.ok(DIAG_SOURCE_CAP < DIAG_TEXT_CAP);
  });
  it('DIAG_MAX_ENTRIES is exactly 20 (per plan)', () => {
    assert.strictEqual(DIAG_MAX_ENTRIES, 20);
  });
});
