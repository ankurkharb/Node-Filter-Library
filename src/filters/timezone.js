/**
 * Time-zone handling.
 *
 * Django interprets naive datetimes, and evaluates date/time transforms
 * (`__date`, `__year`, `__hour`, ...), in `settings.TIME_ZONE`. The equivalent
 * here is the `timeZone` option, which defaults to Sequelize's own `timezone`
 * option (itself `+00:00` by default). A zone is either a fixed offset
 * (`+05:30`) or an IANA name (`Asia/Kolkata`).
 */

import { ConfigurationError } from '../errors/index.js';

const OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

function getFormatter(name) {
  let fmt = formatters.get(name);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: name,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(name, fmt);
  }
  return fmt;
}

/**
 * @typedef {{ name: string, offsetMinutes: number|null }} TimeZone
 *   `offsetMinutes` is set for fixed offsets and null for IANA zones.
 */

/**
 * Validate and normalize a time-zone setting.
 * @param {string} tz
 * @returns {TimeZone}
 */
export function resolveTimeZone(tz) {
  const s = String(tz).trim();
  if (s === 'Z' || s.toUpperCase() === 'UTC') {
    return { name: '+00:00', offsetMinutes: 0 };
  }
  const m = OFFSET_RE.exec(s);
  if (m) {
    const hours = Number(m[2]);
    const minutes = Number(m[3]);
    if (hours > 14 || minutes > 59) {
      throw new ConfigurationError(`Invalid time zone offset "${s}"`);
    }
    const total = hours * 60 + minutes;
    return { name: `${m[1]}${m[2]}:${m[3]}`, offsetMinutes: m[1] === '-' ? -total : total };
  }
  try {
    getFormatter(s);
  } catch {
    throw new ConfigurationError(
      `Invalid time zone "${s}": use an IANA name (e.g. "Europe/Paris") or an offset (e.g. "+05:30")`,
    );
  }
  return { name: s, offsetMinutes: null };
}

function utcMs(year, month, day, hour, minute, second, ms) {
  const d = new Date(Date.UTC(2000, month - 1, day, hour, minute, second, ms));
  d.setUTCFullYear(year); // Date.UTC maps years 0-99 to 1900-1999
  return d.getTime();
}

/** Offset (minutes east of UTC) of an IANA zone at instant `ms`. */
function offsetAt(ms, name) {
  const parts = {};
  for (const p of getFormatter(name).formatToParts(new Date(ms))) parts[p.type] = p.value;
  const asUtc = utcMs(+parts.year, +parts.month, +parts.day, +parts.hour, +parts.minute, +parts.second, 0);
  return (asUtc - Math.floor(ms / 1000) * 1000) / MINUTE;
}

/**
 * Convert a wall-clock time in `zone` to an instant.
 *
 * Mirrors Django's `from_current_timezone`: a wall time that does not exist
 * (spring-forward gap) or exists twice (fall-back overlap) is rejected.
 *
 * @param {{ year: number, month: number, day: number, hour?: number, minute?: number, second?: number, millisecond?: number }} f
 * @param {TimeZone} zone
 * @returns {{ date: Date } | { error: 'nonexistent'|'ambiguous' }}
 */
export function zonedTimeToInstant(f, zone) {
  const wall = utcMs(f.year, f.month, f.day, f.hour ?? 0, f.minute ?? 0, f.second ?? 0, f.millisecond ?? 0);
  if (zone.offsetMinutes !== null) {
    return { date: new Date(wall - zone.offsetMinutes * MINUTE) };
  }
  // Any valid instant for this wall time uses one of the offsets in effect
  // around it; try each and keep those that map back to the same wall time.
  const offsets = new Set([
    offsetAt(wall - DAY, zone.name),
    offsetAt(wall, zone.name),
    offsetAt(wall + DAY, zone.name),
  ]);
  const candidates = new Set();
  for (const off of offsets) {
    const t = wall - off * MINUTE;
    if (offsetAt(t, zone.name) === off) candidates.add(t);
  }
  if (candidates.size === 0) return { error: 'nonexistent' };
  if (candidates.size > 1) return { error: 'ambiguous' };
  return { date: new Date([...candidates][0]) };
}

/**
 * The zone argument for PostgreSQL's `timezone(zone, timestamptz)`.
 * Fixed offsets are passed as an INTERVAL: a text offset such as '+05:30'
 * would be read with POSIX (inverted) sign.
 * @param {TimeZone} zone
 * @param {{ cast: Function }} sql the application's Sequelize class
 */
export function timeZoneSqlArg(zone, sql) {
  return zone.offsetMinutes === null ? zone.name : sql.cast(zone.name, 'interval');
}
