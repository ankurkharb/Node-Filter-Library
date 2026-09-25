import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceBoolean,
  coerceChoice,
  coerceDate,
  coerceDateTime,
  coerceDecimal,
  coerceFloat,
  coerceInteger,
  coerceString,
  coerceTime,
  coerceUuid,
  splitCsv,
} from '../../src/filters/coerce.js';
import { resolveTimeZone } from '../../src/filters/timezone.js';
import { InvalidValueError } from '../../src/errors/index.js';

describe('coerceBoolean (django-filter BooleanWidget)', () => {
  it('accepts true/false/1/0 case-insensitively', () => {
    assert.equal(coerceBoolean('true'), true);
    assert.equal(coerceBoolean('TRUE'), true);
    assert.equal(coerceBoolean('1'), true);
    assert.equal(coerceBoolean('False'), false);
    assert.equal(coerceBoolean('0'), false);
  });
  it('never treats a non-empty string as true', () => {
    assert.equal(coerceBoolean('false'), false);
    assert.equal(coerceBoolean('yes'), null);
  });
  it('maps unknown values to null (filter skipped) unless strict', () => {
    assert.equal(coerceBoolean('maybe'), null);
    assert.equal(coerceBoolean('2'), null);
    assert.throws(() => coerceBoolean('maybe', {}, { strict: true }), InvalidValueError);
  });
  it('returns null for empty', () => {
    assert.equal(coerceBoolean(''), null);
    assert.equal(coerceBoolean(undefined), null);
  });
});

describe('coerceInteger (NumberFilter on an integer column)', () => {
  it('parses integers, zero, negatives, signs and whitespace', () => {
    assert.equal(coerceInteger('18'), 18);
    assert.equal(coerceInteger('0'), 0);
    assert.equal(coerceInteger('-3'), -3);
    assert.equal(coerceInteger('+18'), 18);
    assert.equal(coerceInteger(' 18 '), 18);
  });
  it('truncates decimal input toward zero, like int(Decimal(x))', () => {
    assert.equal(coerceInteger('18.0'), 18);
    assert.equal(coerceInteger('18.7'), 18);
    assert.equal(coerceInteger('-0.5'), 0);
    assert.equal(coerceInteger('-1.9'), -1);
    assert.equal(coerceInteger('1e1'), 10);
    assert.equal(coerceInteger('.5'), 0);
  });
  it('keeps big integers exact as strings', () => {
    assert.equal(coerceInteger('9007199254740993'), '9007199254740993');
  });
  it('rejects non-numbers and absurd magnitudes', () => {
    assert.throws(() => coerceInteger('hello'), InvalidValueError);
    assert.throws(() => coerceInteger('1e400'), InvalidValueError);
    assert.throws(() => coerceInteger('nan'), InvalidValueError);
  });
  it('returns null for empty and whitespace-only', () => {
    assert.equal(coerceInteger(''), null);
    assert.equal(coerceInteger('   '), null);
  });
});

describe('coerceDecimal / coerceFloat', () => {
  it('accepts Python Decimal syntax', () => {
    assert.equal(coerceDecimal('.5'), '.5');
    assert.equal(coerceDecimal('+1.50'), '1.50');
    assert.equal(coerceDecimal('1e3'), '1e3');
  });
  it('rejects non-finite floats', () => {
    assert.equal(coerceFloat('1E0'), 1);
    assert.throws(() => coerceFloat('nan'), InvalidValueError);
    assert.throws(() => coerceFloat('inf'), InvalidValueError);
    assert.throws(() => coerceDecimal('1.2.3'), InvalidValueError);
  });
});

describe('coerceUuid (Python uuid.UUID rules)', () => {
  const canonical = '11111111-1111-4111-8111-111111111111';
  it('accepts dashed, undashed, braced and urn forms', () => {
    assert.equal(coerceUuid(canonical), canonical);
    assert.equal(coerceUuid('11111111111141118111111111111111'), canonical);
    assert.equal(coerceUuid(`{${canonical}}`), canonical);
    assert.equal(coerceUuid(`urn:uuid:${canonical}`), canonical);
  });
  it('accepts any version (v7, nil) and normalizes case', () => {
    assert.equal(coerceUuid('01890A5D-AC96-774B-BCCE-B302099A8057'), '01890a5d-ac96-774b-bcce-b302099a8057');
    assert.equal(coerceUuid('00000000-0000-0000-0000-000000000000'), '00000000-0000-0000-0000-000000000000');
  });
  it('rejects invalid input', () => {
    assert.throws(() => coerceUuid('not-a-uuid'), InvalidValueError);
    assert.throws(() => coerceUuid('1111'), InvalidValueError);
  });
});

describe('coerceDate', () => {
  it('returns a calendar date string, not an instant', () => {
    assert.equal(coerceDate('2024-01-15'), '2024-01-15');
    assert.equal(coerceDate('2024-1-5'), '2024-01-05');
  });
  it("accepts Django's English DATE_INPUT_FORMATS", () => {
    assert.equal(coerceDate('01/15/2024'), '2024-01-15');
    assert.equal(coerceDate('01/15/24'), '2024-01-15');
    assert.equal(coerceDate('01/15/70'), '1970-01-15');
    assert.equal(coerceDate('Jan 15 2024'), '2024-01-15');
    assert.equal(coerceDate('January 15, 2024'), '2024-01-15');
    assert.equal(coerceDate('15 Jan 2024'), '2024-01-15');
  });
  it('rejects impossible dates', () => {
    assert.throws(() => coerceDate('2024-13-01'), InvalidValueError);
    assert.throws(() => coerceDate('2023-02-29'), InvalidValueError);
    assert.throws(() => coerceDate('2024-02-30'), InvalidValueError);
    assert.equal(coerceDate('2024-02-29'), '2024-02-29');
  });
});

describe('coerceDateTime (ISO 8601, IsoDateTimeFilter)', () => {
  const kolkata = resolveTimeZone('Asia/Kolkata');
  it('honours explicit offsets', () => {
    assert.equal(coerceDateTime('2024-01-01T05:30:00+05:30').toISOString(), '2024-01-01T00:00:00.000Z');
    assert.equal(coerceDateTime('2024-01-01T00:00:00Z').toISOString(), '2024-01-01T00:00:00.000Z');
  });
  it('interprets naive values in the configured zone (UTC by default)', () => {
    assert.equal(coerceDateTime('2024-01-01 05:30').toISOString(), '2024-01-01T05:30:00.000Z');
    assert.equal(
      coerceDateTime('2024-01-01 05:30', {}, { timeZone: kolkata }).toISOString(),
      '2024-01-01T00:00:00.000Z',
    );
    assert.equal(coerceDateTime('2024-01-01', {}, { timeZone: kolkata }).toISOString(), '2023-12-31T18:30:00.000Z');
  });
  it('rejects non-ISO formats and garbage that new Date() would accept', () => {
    for (const bad of ['01/01/2024 05:30', '2024', 'March 3', '1', '2024-13-01T00:00']) {
      assert.throws(() => coerceDateTime(bad), InvalidValueError, bad);
    }
  });
  it('rejects wall times that do not exist or are ambiguous in the zone', () => {
    const ny = resolveTimeZone('America/New_York');
    assert.throws(() => coerceDateTime('2024-03-10 02:30', {}, { timeZone: ny }), InvalidValueError);
    assert.throws(() => coerceDateTime('2024-11-03 01:30', {}, { timeZone: ny }), InvalidValueError);
    assert.equal(coerceDateTime('2024-07-01 12:00', {}, { timeZone: ny }).toISOString(), '2024-07-01T16:00:00.000Z');
  });
});

describe('coerceTime', () => {
  it('accepts %H:%M, %H:%M:%S and fractions', () => {
    assert.equal(coerceTime('05:30'), '05:30:00');
    assert.equal(coerceTime('5:30:07'), '05:30:07');
    assert.equal(coerceTime('05:30:07.25'), '05:30:07.250000');
  });
  it('rejects out-of-range values', () => {
    assert.throws(() => coerceTime('25:00'), InvalidValueError);
    assert.throws(() => coerceTime('10:60'), InvalidValueError);
  });
});

describe('coerceChoice', () => {
  it('accepts listed choices, including Django-style pairs', () => {
    assert.equal(coerceChoice('active', ['active', 'pending']), 'active');
    assert.equal(coerceChoice('a', [['a', 'Label A']]), 'a');
  });
  it('does not strip whitespace (ChoiceField)', () => {
    assert.throws(() => coerceChoice(' active', ['active']), InvalidValueError);
  });
  it('rejects others', () => {
    assert.throws(() => coerceChoice('nope', ['active']), InvalidValueError);
  });
});

describe('coerceString', () => {
  it('strips by default (CharField strip=True)', () => {
    assert.equal(coerceString('  john  '), 'john');
    assert.equal(coerceString('   '), '');
    assert.equal(coerceString('  john ', {}, { strip: false }), '  john ');
  });
});

describe('splitCsv (BaseCSVWidget)', () => {
  it('splits without trimming or dropping empty tokens', () => {
    assert.deepEqual(splitCsv('a, b'), ['a', ' b']);
    assert.deepEqual(splitCsv('a,'), ['a', '']);
    assert.deepEqual(splitCsv(','), ['', '']);
  });
  it('treats an empty value as an empty list', () => {
    assert.deepEqual(splitCsv(''), []);
    assert.deepEqual(splitCsv(undefined), []);
  });
  it('uses the last value of a repeated param', () => {
    assert.deepEqual(splitCsv(['a,b', 'c']), ['c']);
  });
});
