import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimeZone, zonedTimeToInstant } from '../../src/filters/timezone.js';
import { ConfigurationError } from '../../src/errors/index.js';

describe('resolveTimeZone', () => {
  it('normalizes offsets, UTC and IANA names', () => {
    assert.deepEqual(resolveTimeZone('+05:30'), { name: '+05:30', offsetMinutes: 330 });
    assert.deepEqual(resolveTimeZone('-0800'), { name: '-08:00', offsetMinutes: -480 });
    assert.deepEqual(resolveTimeZone('UTC'), { name: '+00:00', offsetMinutes: 0 });
    assert.deepEqual(resolveTimeZone('Europe/Paris'), { name: 'Europe/Paris', offsetMinutes: null });
  });
  it('rejects invalid zones as configuration errors', () => {
    assert.throws(() => resolveTimeZone('Mars/Olympus'), ConfigurationError);
    assert.throws(() => resolveTimeZone('+25:00'), ConfigurationError);
  });
});

describe('zonedTimeToInstant', () => {
  it('handles DST on both sides of the transition', () => {
    const paris = resolveTimeZone('Europe/Paris');
    assert.equal(
      zonedTimeToInstant({ year: 2024, month: 1, day: 15, hour: 12 }, paris).date.toISOString(),
      '2024-01-15T11:00:00.000Z',
    );
    assert.equal(
      zonedTimeToInstant({ year: 2024, month: 7, day: 15, hour: 12 }, paris).date.toISOString(),
      '2024-07-15T10:00:00.000Z',
    );
    assert.deepEqual(zonedTimeToInstant({ year: 2024, month: 3, day: 31, hour: 2, minute: 30 }, paris), {
      error: 'nonexistent',
    });
    assert.deepEqual(zonedTimeToInstant({ year: 2024, month: 10, day: 27, hour: 2, minute: 30 }, paris), {
      error: 'ambiguous',
    });
  });
  it('handles years below 100', () => {
    const utc = resolveTimeZone('UTC');
    assert.equal(zonedTimeToInstant({ year: 50, month: 1, day: 1 }, utc).date.getUTCFullYear(), 50);
  });
});
