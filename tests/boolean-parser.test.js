'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseBooleanQuery, evaluateBooleanAst, extractLeafTerms } = require('../keyword-triage-core.js');

// ── AST shape helpers ──
function term(v, opts = {}) { return { type: 'TERM', value: v, ...opts }; }
function and(l, r)           { return { type: 'AND', left: l, right: r }; }
function or(l, r)            { return { type: 'OR', left: l, right: r }; }
function not(o)              { return { type: 'NOT', operand: o }; }

describe('parseBooleanQuery — AST structure', () => {
  it('single term', () => {
    assert.deepEqual(parseBooleanQuery('Python'), term('Python'));
  });

  it('AND of two terms', () => {
    assert.deepEqual(parseBooleanQuery('Python AND Java'), and(term('Python'), term('Java')));
  });

  it('OR of two terms', () => {
    assert.deepEqual(parseBooleanQuery('Python OR Java'), or(term('Python'), term('Java')));
  });

  it('NOT of a term', () => {
    assert.deepEqual(parseBooleanQuery('NOT intern'), not(term('intern')));
  });

  it('AND binds tighter than OR — A OR B AND C ≡ A OR (B AND C)', () => {
    const ast = parseBooleanQuery('Python OR Java AND TensorFlow');
    assert.strictEqual(ast.type, 'OR');
    assert.strictEqual(ast.left.value, 'Python');
    assert.strictEqual(ast.right.type, 'AND');
    assert.strictEqual(ast.right.left.value, 'Java');
    assert.strictEqual(ast.right.right.value, 'TensorFlow');
  });

  it('NOT binds tighter than AND — A AND NOT B', () => {
    const ast = parseBooleanQuery('Python AND NOT intern');
    assert.strictEqual(ast.type, 'AND');
    assert.strictEqual(ast.left.value, 'Python');
    assert.strictEqual(ast.right.type, 'NOT');
    assert.strictEqual(ast.right.operand.value, 'intern');
  });

  it('explicit parentheses override default precedence', () => {
    const ast = parseBooleanQuery('(Python OR Java) AND TensorFlow');
    assert.strictEqual(ast.type, 'AND');
    assert.strictEqual(ast.left.type, 'OR');
    assert.strictEqual(ast.right.value, 'TensorFlow');
  });

  it('quoted phrase becomes a single TERM node', () => {
    const ast = parseBooleanQuery('"machine learning"');
    assert.strictEqual(ast.type, 'TERM');
    assert.strictEqual(ast.value, 'machine learning');
    assert.strictEqual(ast.quoted, true);
  });

  it('smart quotes treated as regular quotes', () => {
    const ast = parseBooleanQuery('“deep learning”');
    assert.strictEqual(ast.type, 'TERM');
    assert.strictEqual(ast.value, 'deep learning');
  });

  it('implicit AND between adjacent terms', () => {
    const ast = parseBooleanQuery('Python Java');
    assert.strictEqual(ast.type, 'AND');
    assert.strictEqual(ast.left.value, 'Python');
    assert.strictEqual(ast.right.value, 'Java');
  });

  it('empty input returns empty TERM', () => {
    const ast = parseBooleanQuery('');
    assert.strictEqual(ast.type, 'TERM');
    assert.strictEqual(ast.value, '');
  });
});

describe('evaluateBooleanAst', () => {
  it('single matched term → true', () => {
    assert.strictEqual(evaluateBooleanAst(term('Python'), { python: true }), true);
  });

  it('single unmatched term → false', () => {
    assert.strictEqual(evaluateBooleanAst(term('Python'), {}), false);
  });

  it('AND — both present → true', () => {
    assert.strictEqual(evaluateBooleanAst(and(term('Python'), term('Java')), { python: true, java: true }), true);
  });

  it('AND — one missing → false', () => {
    assert.strictEqual(evaluateBooleanAst(and(term('Python'), term('Java')), { python: true }), false);
  });

  it('OR — one present → true', () => {
    assert.strictEqual(evaluateBooleanAst(or(term('Python'), term('Java')), { java: true }), true);
  });

  it('OR — none present → false', () => {
    assert.strictEqual(evaluateBooleanAst(or(term('Python'), term('Java')), {}), false);
  });

  it('NOT — term present → false', () => {
    assert.strictEqual(evaluateBooleanAst(not(term('intern')), { intern: true }), false);
  });

  it('NOT — term absent → true', () => {
    assert.strictEqual(evaluateBooleanAst(not(term('intern')), {}), true);
  });

  it('complex: (Python OR Java) AND NOT intern — pass', () => {
    const ast = parseBooleanQuery('(Python OR Java) AND NOT intern');
    assert.strictEqual(evaluateBooleanAst(ast, { python: true }), true);
  });

  it('complex: (Python OR Java) AND NOT intern — fail when intern present', () => {
    const ast = parseBooleanQuery('(Python OR Java) AND NOT intern');
    assert.strictEqual(evaluateBooleanAst(ast, { python: true, intern: true }), false);
  });

  it('complex: (Python OR Java) AND NOT intern — fail when neither Python nor Java', () => {
    const ast = parseBooleanQuery('(Python OR Java) AND NOT intern');
    assert.strictEqual(evaluateBooleanAst(ast, {}), false);
  });

  it('term lookup is case-insensitive via lowercase key', () => {
    // evaluateBooleanAst lowercases the term value before looking up in matchedSet
    assert.strictEqual(evaluateBooleanAst(term('TensorFlow'), { tensorflow: true }), true);
  });
});

describe('extractLeafTerms', () => {
  it('positive terms have negated=false', () => {
    const leaves = extractLeafTerms(parseBooleanQuery('Python AND Java'));
    assert.ok(leaves.every(l => l.negated === false));
    assert.deepEqual(leaves.map(l => l.value), ['Python', 'Java']);
  });

  it('NOT terms have negated=true', () => {
    const leaves = extractLeafTerms(parseBooleanQuery('Python AND NOT intern'));
    const neg = leaves.find(l => l.value === 'intern');
    assert.ok(neg && neg.negated === true);
    const pos = leaves.find(l => l.value === 'Python');
    assert.ok(pos && pos.negated === false);
  });
});
