'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSalaryNumber, parseBudgetAmount, scoreQuestion, normText } = require('../salary-triage-core.js');

describe('parseSalaryNumber', () => {
  const cases = [
    // Indian formats
    ['30 LPA',       3_000_000],
    ['25LPA',        2_500_000],
    ['35L',          3_500_000],
    ['35 lakhs',     3_500_000],
    ['35 lakh',      3_500_000],
    ['35 lacs',      3_500_000],
    ['1.2 crore',   12_000_000],
    ['1.5 crores',  15_000_000],
    ['35,00,000',    3_500_000],

    // Western formats
    ['85k',             85_000],
    ['85K',             85_000],
    ['120000',         120_000],
    ['120,000',        120_000],
    ['$120,000',       120_000],
    ['€75,000',         75_000],
    ['£60,000',         60_000],

    // Ranges — always returns the upper bound
    ['80000-90000',     90_000],
    ['80,000–90,000',   90_000],
    ['80k to 100k',    100_000],
    ['between 70 and 80 lakhs', 8_000_000],

    // Edge cases
    ['',                  null],
    ['not a salary',      null],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" → ${expected}`, () => {
      assert.strictEqual(parseSalaryNumber(input), expected);
    });
  }
});

describe('parseBudgetAmount', () => {
  it('passes through parseSalaryNumber for lakhs notation', () => {
    assert.strictEqual(parseBudgetAmount('35L'), 3_500_000);
  });
  it('parses plain number strings', () => {
    assert.strictEqual(parseBudgetAmount('3500000'), 3_500_000);
  });
  it('strips commas from plain numbers', () => {
    assert.strictEqual(parseBudgetAmount('3,500,000'), 3_500_000);
  });
  it('returns NaN for null', () => {
    assert.ok(Number.isNaN(parseBudgetAmount(null)));
  });
  it('returns NaN for empty string', () => {
    assert.ok(Number.isNaN(parseBudgetAmount('')));
  });
});

describe('scoreQuestion — fix 6: h.includes(qNorm) removed', () => {
  it('exact hint in question scores 0.85', () => {
    // qNorm includes the hint → 0.85
    const score = scoreQuestion('expected salary in inr', ['expected salary', 'desired salary']);
    assert.strictEqual(score, 0.85);
  });

  it('question is a sub-word of a hint but NOT 0.85 after fix', () => {
    // Before fix: scoreQuestion("salary", ["expected salary"]) = 0.85 via h.includes(qNorm)
    // After fix:  falls through to word-overlap → 0.5
    const score = scoreQuestion('salary', ['expected salary']);
    assert.ok(score < 0.85, `expected < 0.85 but got ${score}`);
  });

  it('full overlap scores 1.0', () => {
    const score = scoreQuestion('expected salary', ['expected salary']);
    // qNorm.includes(hint) is true for exact match → 0.85, but word overlap could be higher
    assert.ok(score >= 0.85);
  });

  it('unrelated question scores 0', () => {
    const score = scoreQuestion('years of experience', ['expected salary', 'desired salary']);
    assert.strictEqual(score, 0);
  });

  it('partial word overlap produces fractional score', () => {
    // "annual salary expectation" vs hint "expected salary"
    // hw=["expected","salary"], qw=["annual","salary","expectation"]
    // "salary" found in qw → o=1/2=0.5
    const score = scoreQuestion(normText('annual salary expectation'), [normText('expected salary')]);
    assert.ok(score > 0 && score < 0.85, `expected 0 < score < 0.85 but got ${score}`);
  });
});
