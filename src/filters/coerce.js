/**
 * Controlled type coercion. Query params always arrive as strings; each
 * coercer mirrors the Django form field that django-filter uses for the
 * equivalent filter class, so the same input is accepted or rejected.
 *
 * Every coercer returns `null` for an empty value, which the backends treat as
 * "filter not applied" (django-filter's EMPTY_VALUES).
 */

import { InvalidValueError } from '../errors/index.js';
import { zonedTimeToInstant } from './timezone.js';

/** django.forms.DecimalField input syntax (NumberFilter). */
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Values above this many digits cannot be a PostgreSQL integer; reject as 400 rather than let the DB raise. */
const MAX_INTEGER_DIGITS = 20;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function isEmpty(raw) {
  return raw === null || raw === undefined || raw === '';
}

function invalid(message, raw, meta) {
  return new InvalidValueError(message, { ...meta, value: raw });
}

/** Trimmed string, or null when empty. */
function trimmed(raw) {
  if (isEmpty(raw)) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

/**
 * django-filter `BooleanWidget`: `true`/`1` and `false`/`0`, case-insensitive.
 * Anything else becomes `None` and the filter is skipped — it is not an error
 * unless `strict` is set.
 * @param {unknown} raw
 * @param {object} [meta]
 * @param {{ strict?: boolean }} [options]
 * @returns {boolean|null}
 */
export function coerceBoolean(raw, meta = {}, { strict = false } = {}) {
  if (isEmpty(raw)) return null;
  if (typeof raw === 'boolean') return raw;
  const v = String(raw).toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  if (strict) throw invalid(`Invalid boolean value: ${JSON.stringify(raw)}`, raw, meta);
  return null;
}

/**
 * NumberFilter (DecimalField) input. Returned as a normalized string so no
 * precision is lost before PostgreSQL sees it.
 * @param {unknown} raw
 * @param {object} [meta]
 * @returns {string|null}
 */
export function coerceDecimal(raw, meta = {}) {
  const s = trimmed(raw);
  if (s === null) return null;
  if (!DECIMAL_RE.test(s)) throw invalid('Enter a number.', raw, meta);
  return s.replace(/^\+/, '');
}

/**
 * NumberFilter on an integer column. Django parses a Decimal and the integer
 * field truncates it toward zero (`int(Decimal('18.7')) == 18`), so decimal
 * and exponent syntax are accepted. Returns a number when it is a safe
 * integer, otherwise the exact digit string.
 * @param {unknown} raw
 * @param {object} [meta]
 * @returns {number|string|null}
 */
export function coerceInteger(raw, meta = {}) {
  const s = trimmed(raw);
  if (s === null) return null;
  if (!DECIMAL_RE.test(s)) throw invalid('Enter a number.', raw, meta);
  const digits = truncateDecimal(s);
  if (digits === null || digits.replace('-', '').length > MAX_INTEGER_DIGITS) {
    throw invalid('Number out of range.', raw, meta);
  }
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : digits;
}

/** Exact truncation toward zero of a DECIMAL_RE string; null if absurdly large. */
function truncateDecimal(s) {
  let sign = '';
  if (s[0] === '+' || s[0] === '-') {
    if (s[0] === '-') sign = '-';
    s = s.slice(1);
  }
  const [mantissa, expPart = '0'] = s.toLowerCase().split('e');
  const exp = Number(expPart);
  if (Math.abs(exp) > MAX_INTEGER_DIGITS * 2) return exp > 0 ? null : '0';
  const [intPart, frac = ''] = mantissa.split('.');
  const all = intPart + frac;
  const point = intPart.length + exp;
  let out;
  if (point <= 0) out = '0';
  else if (point >= all.length) out = all + '0'.repeat(point - all.length);
  else out = all.slice(0, point);
  out = out.replace(/^0+(?=\d)/, '') || '0';
  return out === '0' ? '0' : sign + out;
}

/**
 * FloatField: finite numbers only (`nan`/`inf` rejected, as in Django).
 * @param {unknown} raw
 * @param {object} [meta]
 * @returns {number|null}
 */
export function coerceFloat(raw, meta = {}) {
  const s = trimmed(raw);
  if (s === null) return null;
  const n = Number(s);
  if (!DECIMAL_RE.test(s) || !Number.isFinite(n)) throw invalid('Enter a number.', raw, meta);
  return n;
}

/**
 * UUIDField, using Python's `uuid.UUID(hex=...)` rules: any version, dashes
 * optional, surrounding braces and `urn:uuid:` prefix allowed. Returns the
 * canonical lowercase dashed form.
 * @param {unknown} raw
 * @param {object} [meta]
 * @returns {string|null}
 */
export function coerceUuid(raw, meta = {}) {
  const s = trimmed(raw);
  if (s === null) return null;
  const hex = s
    .replaceAll('urn:', '')
    .replaceAll('uuid:', '')
    .replace(/^[{}]+|[{}]+$/g, '')
    .replaceAll('-', '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw invalid('Enter a valid UUID.', raw, meta);
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function isValidDate(y, m, d) {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function twoDigitYear(yy) {
  // Python strptime %y: 69-99 → 1969-1999, 00-68 → 2000-2068
  return yy >= 69 ? 1900 + yy : 2000 + yy;
}

function monthFromName(name) {
  const n = name.toLowerCase();
  const full = MONTH_NAMES.indexOf(n);
  if (full >= 0) return full + 1;
  const abbr = MONTHS.indexOf(n);
  return abbr >= 0 ? abbr + 1 : null;
}

/**
 * Parse Django's English DATE_INPUT_FORMATS.
 * @returns {{ year: number, month: number, day: number } | null}
 */
function parseDateParts(s) {
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return { year: +m[1], month: +m[2], day: +m[3] };
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) return { year: +m[3], month: +m[1], day: +m[2] };
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s))) return { year: twoDigitYear(+m[3]), month: +m[1], day: +m[2] };
  // 'Oct 25 2006', 'Oct 25, 2006', 'October 25 2006', ...
  if ((m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
    const month = monthFromName(m[1]);
    return month ? { year: +m[3], month, day: +m[2] } : null;
  }
  // '25 Oct 2006', '25 Oct, 2006', '25 October 2006', ...
  if ((m = /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/.exec(s))) {
    const month = monthFromName(m[2]);
    return month ? { year: +m[3], month, day: +m[1] } : null;
  }
  return null;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * DateField. A calendar date is not an instant, so it is returned as a
 * `YYYY-MM-DD` string rather than a `Date`.
 * @param {unknown} raw
 * @param {object} [meta]
 * @returns {string|null}
 */
export function coerceDate(raw, meta = {}) {
  const s = trimmed(raw);
  if (s === null) return null;
  const p = parseDateParts(s);
  if (!p || !isValidDate(p.year, p.month, p.day)) throw invalid('Enter a valid date.', raw, meta);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

// django-filter's DRF FilterSet uses IsoDateTimeFilter for datetime columns:
// ISO 8601 only (Django parse_datetime: fromisoformat + datetime_re).
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2})(?::(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,6})\d{0,6})?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

function parseDateTimeParts(s) {
  const m = ISO_DATETIME_RE.exec(s);
  if (!m) return null;
  // An hour without minutes is only valid in the strict ISO form.
  if (m[4] !== undefined && m[5] === undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}/.test(s)) return null;
  return {
    year: +m[1],
    month: +m[2],
    day: +m[3],
    hour: +(m[4] ?? 0),
    minute: +(m[5] ?? 0),
    second: +(m[6] ?? 0),
    millisecond: Math.floor(+(m[7] ?? '0').padEnd(6, '0') / 1000),
    tz: m[8] ?? null,
  };
}

function offsetMinutesOf(tz) {
  if (tz === 'Z') return 0;
  const hours = +tz.slice(1, 3);
  const minutes = tz.length > 3 ? +tz.slice(-2) : 0;
  const total = hours * 60 + minutes;
  return tz[0] === '-' ? -total : total;
}

/**
 * DateTimeField (ISO 8601, as django-filter's IsoDateTimeFilter). An explicit offset is honoured; a naive value is interpreted
 * in `timeZone` (Django: the current time zone). A naive value that does not
 * exist or is ambiguous in that zone is rejected, as in Django.
 * @param {unknown} raw
 * @param {object} [meta]
 * @param {{ timeZone?: import('./timezone.js').TimeZone }} [options]
 * @returns {Date|null}
 */
export function coerceDateTime(raw, meta = {}, { timeZone } = {}) {
  const s = trimmed(raw);
  if (s === null) return null;
  const p = parseDateTimeParts(s);
  if (!p || !isValidDate(p.year, p.month, p.day) || p.hour > 23 || p.minute > 59 || p.second > 59) {
    throw invalid('Enter a valid date/time.', raw, meta);
  }
  const zone =
    p.tz !== null
      ? { name: p.tz, offsetMinutes: offsetMinutesOf(p.tz) }
      : (timeZone ?? { name: '+00:00', offsetMinutes: 0 });
  const result = zonedTimeToInstant(p, zone);
  if ('error' in result) {
    throw invalid(
      `${s} couldn't be interpreted in time zone ${zone.name}; it may be ambiguous or it may not exist.`,
      raw,
      { ...meta, code: 'ambiguous_timezone' },
    );
  }
  return result.date;
}

/**
 * TimeField (`%H:%M`, `%H:%M:%S`, `%H:%M:%S.%f`). Returned as `HH:MM:SS[.ffffff]`.
 * @param {unknown} raw
 * @param {object} [meta]
 * @returns {string|null}
 */
export function coerceTime(raw, meta = {}) {
  const s = trimmed(raw);
  if (s === null) return null;
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,6}))?)?$/.exec(s);
  if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] ?? 0) > 59) throw invalid('Enter a valid time.', raw, meta);
  const base = `${pad(+m[1])}:${pad(+m[2])}:${pad(+(m[3] ?? 0))}`;
  return m[4] ? `${base}.${m[4].padEnd(6, '0')}` : base;
}

/**
 * ChoiceField. Unlike CharField it does NOT strip whitespace: `" active"` is
 * not the choice `"active"` (Django returns 400 for it too).
 * @param {unknown} raw
 * @param {unknown[]} choices — values, or Django-style `[value, label]` pairs
 * @param {object} [meta]
 * @returns {string|null}
 */
export function coerceChoice(raw, choices, meta = {}) {
  if (isEmpty(raw)) return null;
  const s = String(raw);
  const allowed = normalizeChoices(choices);
  if (!allowed.includes(s)) {
    throw invalid(`Select a valid choice. ${s} is not one of the available choices.`, raw, meta);
  }
  return s;
}

/**
 * @param {unknown[]} choices
 * @returns {string[]}
 */
export function normalizeChoices(choices) {
  return (choices || []).map((c) => String(Array.isArray(c) ? c[0] : c));
}

/**
 * CharField. Strips surrounding whitespace by default (`strip=True`), so a
 * whitespace-only value becomes empty and the filter is skipped.
 * @param {unknown} raw
 * @param {object} [meta]
 * @param {{ strip?: boolean }} [options]
 * @returns {string|null}
 */
export function coerceString(raw, _meta = {}, { strip = true } = {}) {
  if (raw === null || raw === undefined) return null;
  return strip ? String(raw).trim() : String(raw);
}

/**
 * Coerce a raw value according to a filter value type.
 * @param {string} type
 * @param {unknown} raw
 * @param {{ choices?: unknown[], strip?: boolean }} [def]
 * @param {{ field?: string, lookup?: string }} [meta]
 * @param {{ timeZone?: import('./timezone.js').TimeZone, strictBooleans?: boolean }} [options]
 */
export function coerceValue(type, raw, def = {}, meta = {}, options = {}) {
  switch (type) {
    case 'string':
    case 'char':
      return coerceString(raw, meta, { strip: def.strip !== false });
    case 'integer':
      return coerceInteger(raw, meta);
    case 'number':
    case 'decimal':
      return coerceDecimal(raw, meta);
    case 'float':
      return coerceFloat(raw, meta);
    case 'boolean':
      return coerceBoolean(raw, meta, { strict: options.strictBooleans });
    case 'uuid':
      return coerceUuid(raw, meta);
    case 'date':
      return coerceDate(raw, meta);
    case 'datetime':
      return coerceDateTime(raw, meta, { timeZone: options.timeZone });
    case 'time':
      return coerceTime(raw, meta);
    case 'choice':
      return coerceChoice(raw, def.choices || [], meta);
    default:
      throw new TypeError(`coerceValue: unknown type "${type}"`);
  }
}

/**
 * django-filter `BaseCSVWidget`: `''` → `[]`, otherwise split on `,` with no
 * trimming and no dropping of empty tokens (each token is cleaned by the
 * element type later). A repeated param uses its last value.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function splitCsv(raw) {
  if (Array.isArray(raw)) raw = raw[raw.length - 1];
  if (raw === null || raw === undefined || raw === '') return [];
  return String(raw).split(',');
}
