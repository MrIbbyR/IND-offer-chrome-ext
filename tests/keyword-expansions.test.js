'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveKeywords,
  resolveKeywordsWithMeta,
  expandKeywords,
  applyTypoAliases,
  parseKeywordsFromString,
  canonicalizeKeywords,
} = require('../keyword-expansions.js');

describe('parseKeywordsFromString', () => {
  it('splits on commas', () => {
    assert.deepEqual(parseKeywordsFromString('Python, Java, R'), ['Python', 'Java', 'R']);
  });

  it('splits on semicolons', () => {
    assert.deepEqual(parseKeywordsFromString('Python; Java'), ['Python', 'Java']);
  });

  it('splits on newlines', () => {
    assert.deepEqual(parseKeywordsFromString('Python\nJava'), ['Python', 'Java']);
  });

  it('skips lines starting with #', () => {
    const result = parseKeywordsFromString('Python\n# comment\nJava');
    assert.ok(!result.includes('# comment'));
    assert.deepEqual(result, ['Python', 'Java']);
  });

  it('empty string returns empty array', () => {
    assert.deepEqual(parseKeywordsFromString(''), []);
  });

  it('trims whitespace from each keyword', () => {
    assert.deepEqual(parseKeywordsFromString('  Python  ,  Java  '), ['Python', 'Java']);
  });
});

describe('canonicalizeKeywords', () => {
  it('removes case-duplicates, keeping first occurrence', () => {
    assert.deepEqual(canonicalizeKeywords(['Python', 'python', 'PYTHON']), ['Python']);
  });

  it('removes blank entries', () => {
    assert.deepEqual(canonicalizeKeywords(['Python', '', '  ']), ['Python']);
  });

  it('preserves order of first occurrence', () => {
    assert.deepEqual(canonicalizeKeywords(['Java', 'Python', 'java']), ['Java', 'Python']);
  });
});

describe('applyTypoAliases', () => {
  it('fixes known typos', () => {
    assert.deepEqual(applyTypoAliases(['pytroch']), ['pytorch']);
    assert.deepEqual(applyTypoAliases(['tensorlfow']), ['tensorflow']);
    assert.deepEqual(applyTypoAliases(['azuer']), ['azure']);
  });

  it('leaves correct spellings unchanged', () => {
    assert.deepEqual(applyTypoAliases(['pytorch', 'tensorflow']), ['pytorch', 'tensorflow']);
  });

  it('handles mixed array', () => {
    const result = applyTypoAliases(['pytroch', 'Python']);
    assert.strictEqual(result[0], 'pytorch');
    assert.strictEqual(result[1], 'Python');
  });
});

describe('expandKeywords — bidirectional expansion', () => {
  it('ml → includes "machine learning"', () => {
    const expanded = expandKeywords(['ml']);
    assert.ok(expanded.some(k => k.toLowerCase() === 'machine learning'));
  });

  it('"machine learning" → includes "ml"', () => {
    const expanded = expandKeywords(['machine learning']);
    assert.ok(expanded.some(k => k.toLowerCase() === 'ml'));
  });

  it('pytorch → includes "torch"', () => {
    const expanded = expandKeywords(['pytorch']);
    assert.ok(expanded.some(k => k.toLowerCase() === 'torch'));
  });

  it('k8s → includes "kubernetes"', () => {
    const expanded = expandKeywords(['k8s']);
    assert.ok(expanded.some(k => k.toLowerCase() === 'kubernetes'));
  });

  it('no duplicate forms after expansion', () => {
    const expanded = expandKeywords(['ml', 'machine learning']);
    const lower = expanded.map(k => k.toLowerCase());
    const unique = [...new Set(lower)];
    assert.strictEqual(lower.length, unique.length);
  });
});

describe('resolveKeywords — full pipeline', () => {
  it('typo-fixes, expands, and deduplicates', () => {
    const result = resolveKeywords('pytroch');
    // pytroch → pytorch → expanded to include torch, py torch, etc.
    assert.ok(result.some(k => k.toLowerCase() === 'pytorch'));
    assert.ok(result.some(k => k.toLowerCase() === 'torch'));
  });

  it('comma-separated input', () => {
    const result = resolveKeywords('ml, dl');
    assert.ok(result.some(k => k.toLowerCase() === 'ml'));
    assert.ok(result.some(k => k.toLowerCase() === 'machine learning'));
    assert.ok(result.some(k => k.toLowerCase() === 'deep learning'));
  });

  it('no duplicates in output', () => {
    const result = resolveKeywords('ml, machine learning');
    const lower = result.map(k => k.toLowerCase());
    const unique = [...new Set(lower)];
    assert.strictEqual(lower.length, unique.length);
  });

  it('empty input returns empty array', () => {
    assert.deepEqual(resolveKeywords(''), []);
  });
});

describe('resolveKeywordsWithMeta', () => {
  it('returns keywords array identical to resolveKeywords', () => {
    const { keywords } = resolveKeywordsWithMeta('pytorch, tensorflow');
    const plain = resolveKeywords('pytorch, tensorflow');
    assert.deepEqual(keywords, plain);
  });

  it('user-typed keyword maps to itself in canonicalMap', () => {
    const { canonicalMap } = resolveKeywordsWithMeta('pytorch, tensorflow');
    assert.strictEqual(canonicalMap['pytorch'], 'pytorch');
    assert.strictEqual(canonicalMap['tensorflow'], 'tensorflow');
  });

  it('expansion forms map back to the user-typed canonical', () => {
    const { canonicalMap } = resolveKeywordsWithMeta('tensorflow');
    assert.strictEqual(canonicalMap['tensor flow'], 'tensorflow');
    assert.strictEqual(canonicalMap['tensor-flow'], 'tensorflow');
  });

  it('when user types both canonical and an alias, each maps to itself', () => {
    // User explicitly types "tensorflow" AND "tensor flow" — both are canonical
    const { canonicalMap } = resolveKeywordsWithMeta('tensorflow, tensor flow');
    assert.strictEqual(canonicalMap['tensorflow'], 'tensorflow');
    assert.strictEqual(canonicalMap['tensor flow'], 'tensor flow');
  });

  it('userCount equals the number of keywords before expansion', () => {
    const { userCount, keywords } = resolveKeywordsWithMeta('pytorch, tensorflow, sklearn');
    assert.strictEqual(userCount, 3);
    assert.ok(keywords.length > 3); // expanded list must be larger
  });

  it('typo is corrected before building canonicalMap', () => {
    const { canonicalMap } = resolveKeywordsWithMeta('pytroch'); // typo → pytorch
    assert.strictEqual(canonicalMap['pytorch'], 'pytorch');
    // expansion of pytorch is also mapped back
    assert.ok(canonicalMap['py torch'] === 'pytorch' || canonicalMap['torch'] === 'pytorch');
  });

  it('empty input returns empty keywords and empty map', () => {
    const { keywords, canonicalMap, userCount } = resolveKeywordsWithMeta('');
    assert.deepEqual(keywords, []);
    assert.strictEqual(Object.keys(canonicalMap).length, 0);
    assert.strictEqual(userCount, 0);
  });
});
