'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeForKw,
  buildTokenIndex,
  kwHitsInIndex,
  sepFlexiblePatternSource,
  isoListHit,
  findKeywordHits,
  deduplicateHitsByCanonical,
} = require('../keyword-triage-core.js');
const { resolveKeywordsWithMeta } = require('../keyword-expansions.js');

describe('normalizeForKw', () => {
  it('strips zero-width chars', () => {
    assert.strictEqual(normalizeForKw('Pyth​on'), 'Python');
  });
  it('normalises non-breaking spaces to regular space', () => {
    assert.strictEqual(normalizeForKw('A B'), 'A B');
  });
  it('collapses runs of whitespace', () => {
    assert.strictEqual(normalizeForKw('A   B'), 'A B');
  });
  it('NFKC form: ﬁ → fi', () => {
    assert.strictEqual(normalizeForKw('ﬁeld'), 'field');
  });
  it('trims leading/trailing whitespace', () => {
    assert.strictEqual(normalizeForKw('  hello  '), 'hello');
  });
});

describe('buildTokenIndex + kwHitsInIndex', () => {
  it('unigram match', () => {
    const idx = buildTokenIndex('Python developer with 3 years');
    assert.ok(kwHitsInIndex('python', idx, false) > 0);
  });

  it('bigram match', () => {
    const idx = buildTokenIndex('machine learning engineer');
    assert.ok(kwHitsInIndex('machine learning', idx, false) > 0);
  });

  it('trigram match', () => {
    const idx = buildTokenIndex('natural language processing skills');
    assert.ok(kwHitsInIndex('natural language processing', idx, false) > 0);
  });

  it('4-token phrase returns -1 (signals regex fallback)', () => {
    const idx = buildTokenIndex('anything');
    assert.strictEqual(kwHitsInIndex('one two three four', idx, false), -1);
  });

  it('unigram not present returns 0', () => {
    const idx = buildTokenIndex('Java Spring Boot');
    assert.strictEqual(kwHitsInIndex('python', idx, false), 0);
  });

  it('suffix variants match — "publications" matches keyword "publication"', () => {
    const idx = buildTokenIndex('authored several publications');
    assert.ok(kwHitsInIndex('publication', idx, false) > 0);
  });

  it('CamelCase splitting — "TensorFlow" in text matches keyword "tensor flow"', () => {
    const idx = buildTokenIndex(normalizeForKw('experience with TensorFlow'));
    assert.ok(kwHitsInIndex('tensor flow', idx, false) > 0);
  });

  it('wildcard prefix matches all tokens starting with prefix', () => {
    const idx = buildTokenIndex('python pythonic pythonista');
    assert.ok(kwHitsInIndex('python', idx, true) >= 3);
  });
});

describe('sepFlexiblePatternSource', () => {
  it('generates separator-flexible pattern that matches hyphenated form', () => {
    const src = sepFlexiblePatternSource('gpt4', true);
    const rx = new RegExp(src, 'gi');
    assert.ok(rx.test('GPT-4'));
  });

  it('matches hyphenated form', () => {
    const src = sepFlexiblePatternSource('scikit learn', true);
    assert.ok(new RegExp(src, 'i').test('scikit-learn'));
  });

  it('matches underscore-separated form', () => {
    const src = sepFlexiblePatternSource('scikit learn', true);
    assert.ok(new RegExp(src, 'i').test('scikit_learn'));
  });
});

describe('isoListHit — fix 3: proximity window on normalised (newline-free) text', () => {
  it('detects ISO number within proximity of ISO keyword', () => {
    // normalizeForKw removes newlines, so chunks in the original code were useless
    const hay = normalizeForKw('Certified to ISO Standard 9001 and 45001');
    assert.strictEqual(isoListHit(hay, '45001'), true);
  });

  it('does not match when number is far from ISO keyword', () => {
    // number 45001 appears but 400+ chars away from "ISO"
    const hay = 'ISO certified ' + 'x'.repeat(400) + ' 45001';
    assert.strictEqual(isoListHit(hay, '45001'), false);
  });

  it('handles no ISO keyword', () => {
    assert.strictEqual(isoListHit('certified to standard 9001', '9001'), false);
  });

  it('empty num returns false', () => {
    assert.strictEqual(isoListHit('ISO 9001', ''), false);
  });
});

describe('findKeywordHits', () => {
  it('finds a simple unigram keyword', () => {
    const { hitCount, hits } = findKeywordHits('Experienced Python developer', ['Python']);
    assert.strictEqual(hitCount, 1);
    assert.strictEqual(hits[0].keyword, 'Python');
  });

  it('case-insensitive match', () => {
    const { hitCount } = findKeywordHits('python and TENSORFLOW', ['Python', 'TensorFlow']);
    assert.strictEqual(hitCount, 2);
  });

  it('fix 2: compound form "GPT-4" matched by keyword "gpt4" via regex fallback', () => {
    // Token index splits "GPT-4" into ["gpt","4"] — unigram "gpt4" won't be in the index.
    // After fix 2, idxResult===0 falls through to sepFlexiblePatternSource regex.
    const { hitCount } = findKeywordHits('proficient in GPT-4 and GPT4 models', ['gpt4']);
    assert.ok(hitCount > 0, 'expected gpt4 to match GPT-4 via regex fallback');
  });

  it('ISO heuristic: "ISO 45001" matches text "ISO Standard (9001, 45001)"', () => {
    const text = normalizeForKw('Certified to ISO Standard (9001, 45001)');
    const { hitCount } = findKeywordHits(text, ['ISO 45001']);
    assert.ok(hitCount > 0, 'expected ISO 45001 to be found via isoListHit');
  });

  it('wildcard: "Python*" matches "Pythonic" and "Python3"', () => {
    const { hits } = findKeywordHits('built Pythonic Python3 tools', ['Python*']);
    assert.ok(hits.length > 0);
    assert.ok(hits[0].count >= 2);
  });

  it('counts multiple occurrences', () => {
    const { hits } = findKeywordHits('Python Python Python', ['Python']);
    assert.strictEqual(hits[0].count, 3);
  });

  it('no match returns empty hits and hitCount 0', () => {
    const { hitCount, hits } = findKeywordHits('Java Spring developer', ['Python']);
    assert.strictEqual(hitCount, 0);
    assert.strictEqual(hits.length, 0);
  });

  it('empty text returns no hits', () => {
    const { hitCount } = findKeywordHits('', ['Python', 'Java']);
    assert.strictEqual(hitCount, 0);
  });

  it('deduplicates same keyword (different case input)', () => {
    const { hitCount } = findKeywordHits('python', ['Python', 'python', 'PYTHON']);
    assert.strictEqual(hitCount, 1);
  });
});

describe('deduplicateHitsByCanonical', () => {
  it('collapses expansion aliases to the canonical form', () => {
    const hits = [
      { keyword: 'tensorflow', count: 2 },
      { keyword: 'tensor flow', count: 2 },
      { keyword: 'tensor-flow', count: 2 },
    ];
    const map = { tensorflow: 'tensorflow', 'tensor flow': 'tensorflow', 'tensor-flow': 'tensorflow' };
    const out = deduplicateHitsByCanonical(hits, map);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].keyword, 'tensorflow');
    assert.strictEqual(out[0].count, 2);
  });

  it('keeps distinct canonical keywords separate', () => {
    const hits = [
      { keyword: 'pytorch', count: 2 },
      { keyword: 'py torch', count: 2 },
      { keyword: 'tensorflow', count: 1 },
    ];
    const map = { pytorch: 'pytorch', 'py torch': 'pytorch', tensorflow: 'tensorflow' };
    const out = deduplicateHitsByCanonical(hits, map);
    assert.strictEqual(out.length, 2);
    assert.ok(out.some(h => h.keyword === 'pytorch' && h.count === 2));
    assert.ok(out.some(h => h.keyword === 'tensorflow' && h.count === 1));
  });

  it('uses max count across the alias group', () => {
    // e.g. standalone "torch" appears more often than "pytorch" itself
    const hits = [
      { keyword: 'pytorch', count: 1 },
      { keyword: 'torch', count: 3 },
    ];
    const map = { pytorch: 'pytorch', torch: 'pytorch' };
    const out = deduplicateHitsByCanonical(hits, map);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].count, 3);
  });

  it('reports canonical name even when only an expansion matched', () => {
    // resume says "py torch" never "pytorch"
    const hits = [{ keyword: 'py torch', count: 2 }];
    const map = { pytorch: 'pytorch', 'py torch': 'pytorch', 'py-torch': 'pytorch' };
    const out = deduplicateHitsByCanonical(hits, map);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].keyword, 'pytorch');
    assert.strictEqual(out[0].count, 2);
  });

  it('is a no-op when canonicalMap is null', () => {
    const hits = [{ keyword: 'python', count: 1 }];
    const out = deduplicateHitsByCanonical(hits, null);
    assert.deepEqual(out, hits);
  });

  it('preserves insertion order of first canonical appearance', () => {
    const hits = [
      { keyword: 'py torch', count: 1 },
      { keyword: 'tensorflow', count: 1 },
      { keyword: 'pytorch', count: 1 },
    ];
    const map = { pytorch: 'pytorch', 'py torch': 'pytorch', tensorflow: 'tensorflow' };
    const out = deduplicateHitsByCanonical(hits, map);
    // "pytorch" group encountered first via "py torch", tensorflow second
    assert.strictEqual(out[0].keyword, 'pytorch');
    assert.strictEqual(out[1].keyword, 'tensorflow');
  });
});

describe('findKeywordHits + deduplicateHitsByCanonical integration', () => {
  it('PyTorch in text → one "pytorch" entry, not pytorch + py torch separately', () => {
    const text = 'Extensive experience with PyTorch and pytorch lightning';
    const { keywords, canonicalMap } = resolveKeywordsWithMeta('pytorch');
    const { hits } = findKeywordHits(text, keywords);
    const out = deduplicateHitsByCanonical(hits, canonicalMap);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].keyword, 'pytorch');
  });

  it('TensorFlow in text → one "tensorflow" entry, not three alias entries', () => {
    const text = 'Built production models in TensorFlow 2 and Keras';
    const { keywords, canonicalMap } = resolveKeywordsWithMeta('tensorflow');
    const { hits } = findKeywordHits(text, keywords);
    const out = deduplicateHitsByCanonical(hits, canonicalMap);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].keyword, 'tensorflow');
  });

  it('hitCount equals number of distinct user keywords found', () => {
    const text = 'Skilled in PyTorch, TensorFlow, and scikit-learn';
    const { keywords, canonicalMap, userCount } = resolveKeywordsWithMeta('pytorch, tensorflow, sklearn');
    const { hits } = findKeywordHits(text, keywords);
    const out = deduplicateHitsByCanonical(hits, canonicalMap);
    // All 3 user keywords should be found, regardless of how many aliases also matched
    assert.strictEqual(out.length, 3);
    assert.strictEqual(userCount, 3);
  });
});
