import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allValues,
  lastValue,
  normalizeQuery,
  parseOrdering,
  searchSmartSplit,
  splitSearchTerms,
} from '../../src/parser/index.js';

describe('normalizeQuery', () => {
  it('handles plain objects with repeated keys as arrays', () => {
    const q = normalizeQuery({ a: '1', b: ['x', 'y'], n: 5 });
    assert.equal(q.a, '1');
    assert.deepEqual(q.b, ['x', 'y']);
    assert.equal(q.n, '5');
  });
  it('parses query strings and URLSearchParams, keeping repeats', () => {
    assert.deepEqual(normalizeQuery('?s=a&s=b&t=1'), { s: ['a', 'b'], t: '1' });
    assert.deepEqual(normalizeQuery(new URLSearchParams('s=a')), { s: 'a' });
  });
  it('drops nested objects (qs-style ?age[gte]=1)', () => {
    assert.deepEqual(normalizeQuery({ age: { gte: '1' }, ok: 'y' }), { ok: 'y' });
  });
  it('stores __proto__ as data without touching prototypes', () => {
    const q = normalizeQuery('?__proto__=x&constructor=y');
    assert.equal(Object.getPrototypeOf(q), Object.prototype);
    assert.equal(q.__proto__, 'x');
    assert.equal({}.x, undefined);
  });
});

describe('lastValue / allValues (QueryDict.get / getlist)', () => {
  it('reads the last value of a repeated param', () => {
    assert.equal(lastValue(['a', 'b']), 'b');
    assert.equal(lastValue('a'), 'a');
    assert.deepEqual(allValues(['a', 'b']), ['a', 'b']);
    assert.deepEqual(allValues(undefined), []);
  });
});

describe('splitSearchTerms (SearchFilter: commas only)', () => {
  const cases = [
    ['a', ['a']],
    ['a,b', ['a', 'b']],
    ['a,b,c', ['a', 'b', 'c']],
    ['ankur kharb', ['ankur kharb']],
    ['ankur,kharb', ['ankur', 'kharb']],
    ['ankur kharb,rahul kumar', ['ankur kharb', 'rahul kumar']],
    ['a, b, c', ['a', 'b', 'c']],
    ['ankur, kharb', ['ankur', 'kharb']],
    ['rahul', ['rahul']],
    ['rahul kumar', ['rahul kumar']],
    ['rahul,kumar', ['rahul', 'kumar']],
    ['rahul, kumar', ['rahul', 'kumar']],
    ['rahul ,kumar', ['rahul', 'kumar']],
    ['rahul , kumar', ['rahul', 'kumar']],
    ['rahul kumar, amit sharma', ['rahul kumar', 'amit sharma']],
    ['rahul,,kumar,', ['rahul', 'kumar']],
    ['  rahul kumar  ', ['rahul kumar']],
    ['rahul   kumar', ['rahul   kumar']],
    ['  ,  , ', []],
    ['a,,b', ['a', 'b']],
    [',a,', ['a']],
    ['JOHN doe', ['JOHN doe']],
    ['"john doe"', ['john doe']],
    ["'john doe'", ['john doe']],
    ['"john doe",rahul kumar', ['john doe', 'rahul kumar']],
    ['"john doe", rahul kumar', ['john doe', 'rahul kumar']],
    ['rahul kumar,amit sharma', ['rahul kumar', 'amit sharma']],
    ['"a,b",c', ['a,b', 'c']],
    ['"say \\"hi\\""', ['say "hi"']],
    ['  "  padded  "  ', ['  padded  ']],
    ['"', []],
    ['""', []],
    ['"unterminated, x', ['"unterminated', 'x']],
    ['a"b,c', ['a"b', 'c']],
    ['"john doe" x', ['"john doe" x']],
    ['^ankur,^rahul', ['^ankur', '^rahul']],
    ['', []],
    [',', []],
  ];
  for (const [input, expected] of cases) {
    it(JSON.stringify(input), () => assert.deepEqual(splitSearchTerms(input), expected));
  }
});

describe('searchSmartSplit (DRF search_smart_split, not used by SearchFilter)', () => {
  const cases = [
    ['john doe', ['john', 'doe']],
    ['john, doe smith', ['john', 'doe', 'smith']],
    ['john,,doe', ['john', 'doe']],
    [',john,', ['john']],
    ['"john doe" smith', ['john doe', 'smith']],
    ["'john doe'", ['john doe']],
    ['"a \\"b\\" c"', ['a "b" c']],
    ['"', ['']],
    ['', []],
    ['   ', []],
  ];
  for (const [input, expected] of cases) {
    it(JSON.stringify(input), () => assert.deepEqual(searchSmartSplit(input), expected));
  }
});

describe('parseOrdering', () => {
  it('parses directions, trims, drops empty terms', () => {
    assert.deepEqual(parseOrdering(' -created_at , name ,,'), [
      { term: '-created_at', field: 'created_at', direction: 'DESC' },
      { term: 'name', field: 'name', direction: 'ASC' },
    ]);
  });
  it('uses the last value of a repeated param', () => {
    assert.deepEqual(
      parseOrdering(['age', '-name']).map((o) => o.term),
      ['-name'],
    );
  });
});
