import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Op, Sequelize } from 'sequelize';
import {
  assertSafeRegex,
  buildLookupCondition,
  escapeLike,
  isKnownLookup,
  lookupValueType,
  parseLookup,
} from '../../src/lookups/index.js';
import { ConfigurationError, InvalidValueError } from '../../src/errors/index.js';

describe('parseLookup', () => {
  it('parses comparisons, transforms and transform__comparison', () => {
    assert.deepEqual(parseLookup('gte'), { name: 'gte', transform: null, op: 'gte' });
    assert.deepEqual(parseLookup('year'), { name: 'year', transform: 'year', op: 'exact' });
    assert.deepEqual(parseLookup('year__gte'), { name: 'year__gte', transform: 'year', op: 'gte' });
  });
  it('rejects unknown and nonsensical combinations', () => {
    for (const bad of ['bogus', 'gte__year', 'year__icontains', 'year__month', '', 'exact__']) {
      assert.equal(parseLookup(bad), null, bad);
    }
    assert.equal(isKnownLookup('iso_week_day'), true);
  });
});

describe('lookupValueType', () => {
  it('coerces by lookup, not by field type', () => {
    assert.equal(lookupValueType(parseLookup('year'), 'datetime'), 'integer');
    assert.equal(lookupValueType(parseLookup('week_day'), 'datetime'), 'integer');
    assert.equal(lookupValueType(parseLookup('date'), 'datetime'), 'date');
    assert.equal(lookupValueType(parseLookup('time'), 'datetime'), 'time');
    assert.equal(lookupValueType(parseLookup('isnull'), 'uuid'), 'boolean');
    assert.equal(lookupValueType(parseLookup('icontains'), 'integer'), 'integer');
    assert.equal(lookupValueType(parseLookup('icontains'), 'choice'), 'string');
  });
});

describe('escapeLike', () => {
  it('escapes %, _ and backslash', () => {
    assert.equal(escapeLike('100%_\\'), '100\\%\\_\\\\');
  });
});

describe('buildLookupCondition', () => {
  it('maps comparisons to Sequelize operators', () => {
    assert.deepEqual(buildLookupCondition('age', 'gte', 18), { age: { [Op.gte]: 18 } });
    assert.deepEqual(buildLookupCondition('age', 'range', [1, 2]), { age: { [Op.between]: [1, 2] } });
    assert.deepEqual(buildLookupCondition('name', 'icontains', '50%'), { name: { [Op.iLike]: '%50\\%%' } });
    assert.deepEqual(buildLookupCondition('name', 'iexact', 'a_b'), { name: { [Op.iLike]: 'a\\_b' } });
    assert.deepEqual(buildLookupCondition('d', 'isnull', true), { d: { [Op.is]: null } });
    assert.deepEqual(buildLookupCondition('d', 'isnull', false), { d: { [Op.not]: null } });
  });
  it('builds transforms as Sequelize.where expressions', () => {
    const cond = buildLookupCondition('created_at', 'year__gte', 2024);
    assert.ok(cond instanceof Sequelize.where('x', 1).constructor);
  });
  it('throws ConfigurationError for unknown lookups', () => {
    assert.throws(() => buildLookupCondition('a', 'nope', 1), ConfigurationError);
  });
});

describe('assertSafeRegex', () => {
  it('allows ordinary patterns, including ones PostgreSQL evaluates cheaply', () => {
    for (const ok of [
      '^jo',
      'john.*',
      '(a+)+$',
      '^(a|a)*$',
      '[a-z]{1,255}',
      '(a{1,20}){1,20}',
      '.*.*.*=',
      '[[:alpha:]]+',
    ]) {
      assert.doesNotThrow(() => assertSafeRegex(ok), ok);
    }
  });
  it('rejects patterns that make PostgreSQL error or blow up', () => {
    const cases = {
      '(a{1,255}){1,255}': 'unsafe_regex',
      '(.{1,100}){1,100}': 'unsafe_regex',
      'a{256}': 'unsafe_regex',
      '(x+)\\1': 'unsafe_regex',
      '(': 'invalid_regex',
      'a{1,100}{1,100}': 'invalid_regex',
    };
    for (const [pattern, code] of Object.entries(cases)) {
      assert.throws(
        () => assertSafeRegex(pattern),
        (err) => err instanceof InvalidValueError && err.code === code,
        pattern,
      );
    }
    assert.throws(() => assertSafeRegex('a'.repeat(201)), InvalidValueError);
  });
});
