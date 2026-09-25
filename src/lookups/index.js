/**
 * Lookup registry and condition builder.
 *
 * A lookup is `op`, `transform` or `transform__op`, as in Django
 * (`gte`, `year`, `year__gte`). Lookup names only ever come from the
 * developer's configuration; client input selects among declared params and
 * never reaches an operator directly.
 */

import { Op, Sequelize as Bundled } from 'sequelize';
import { ConfigurationError, InvalidValueError } from '../errors/index.js';
import { timeZoneSqlArg } from '../filters/timezone.js';

export const DEFAULT_LOOKUP = 'exact';

/** Comparison lookups that can be applied directly to a column. */
const COMPARISONS = [
  'exact',
  'iexact',
  'contains',
  'icontains',
  'startswith',
  'istartswith',
  'endswith',
  'iendswith',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'range',
  'isnull',
  'regex',
  'iregex',
  'search',
];

/** Lookups whose value is text and whose column may need a text cast. */
export const TEXT_LOOKUPS = new Set([
  'iexact',
  'contains',
  'icontains',
  'startswith',
  'istartswith',
  'endswith',
  'iendswith',
  'regex',
  'iregex',
  'search',
]);

/**
 * Date/time transforms → the type of value they produce.
 * `week_day` is Django's 1 = Sunday … 7 = Saturday; `iso_week_day` is 1 = Monday.
 */
export const TRANSFORMS = Object.freeze({
  date: 'date',
  time: 'time',
  year: 'integer',
  iso_year: 'integer',
  month: 'integer',
  day: 'integer',
  week: 'integer',
  week_day: 'integer',
  iso_week_day: 'integer',
  quarter: 'integer',
  hour: 'integer',
  minute: 'integer',
  second: 'integer',
});

/** Which transforms each column type supports (Django: DateField vs DateTimeField vs TimeField). */
export const TRANSFORMS_FOR_TYPE = Object.freeze({
  datetime: new Set(Object.keys(TRANSFORMS)),
  date: new Set(['year', 'iso_year', 'month', 'day', 'week', 'week_day', 'iso_week_day', 'quarter']),
  time: new Set(['hour', 'minute', 'second']),
});

/** Comparisons allowed after a transform (`created_at__year__gte`). */
const TRANSFORM_COMPARISONS = new Set(['exact', 'gt', 'gte', 'lt', 'lte', 'in', 'range']);

const DATE_PART = {
  year: 'year',
  iso_year: 'isoyear',
  month: 'month',
  day: 'day',
  week: 'week',
  week_day: 'dow',
  iso_week_day: 'isodow',
  quarter: 'quarter',
  hour: 'hour',
  minute: 'minute',
  second: 'second',
};

/** Every bare lookup name (comparisons and transforms). */
export const ALL_LOOKUPS = new Set([...COMPARISONS, ...Object.keys(TRANSFORMS)]);

/**
 * @typedef {{ name: string, transform: string|null, op: string }} ParsedLookup
 */

/**
 * Parse `op`, `transform` or `transform__op`.
 * @param {string} name
 * @returns {ParsedLookup|null}
 */
export function parseLookup(name) {
  if (typeof name !== 'string') return null;
  const parts = name.split('__');
  if (parts.length === 1) {
    if (COMPARISONS.includes(name)) return { name, transform: null, op: name };
    if (name in TRANSFORMS) return { name, transform: name, op: 'exact' };
    return null;
  }
  if (parts.length === 2 && parts[0] in TRANSFORMS && TRANSFORM_COMPARISONS.has(parts[1])) {
    return { name, transform: parts[0], op: parts[1] };
  }
  return null;
}

/** @param {string} name */
export function isKnownLookup(name) {
  return parseLookup(name) !== null;
}

/**
 * The value type a lookup expects, given the filter's value type.
 * Text lookups keep the filter's type, as in django-filter (`age__icontains`
 * is a NumberFilter), except on choices, where django-filter uses a CharFilter.
 * @param {ParsedLookup} parsed
 * @param {string} type
 */
export function lookupValueType(parsed, type) {
  if (parsed.op === 'isnull') return 'boolean';
  if (parsed.transform) return TRANSFORMS[parsed.transform];
  if (parsed.op === 'search') return 'string';
  if (type === 'choice' && TEXT_LOOKUPS.has(parsed.op)) return 'string';
  return type;
}

/**
 * Escape LIKE / ILIKE wildcards so user input is literal (Django does the same).
 * @param {string} value
 */
export function escapeLike(value) {
  return String(value).replace(/([\\%_])/g, '\\$1');
}

/** PostgreSQL's maximum repetition count (RE_DUPMAX). */
const PG_MAX_REPETITION = 255;
/** Product of nested bounded repetitions above which PostgreSQL's compiled regex grows too large. */
const MAX_REPETITION_WEIGHT = 1000;

/**
 * Validate a client-supplied regex before PostgreSQL compiles it.
 *
 * PostgreSQL's engine does not backtrack exponentially on shapes like
 * `(a+)+`; its cost is in compiling nested *bounded* repetition, which can
 * fail with "regular expression is too complex". Rejected:
 * - patterns longer than `maxLength`
 * - invalid syntax (checked with the JavaScript parser)
 * - back-references (the one construct that forces PostgreSQL to backtrack)
 * - repetition counts above 255 (PostgreSQL rejects them)
 * - nested bounded repetition whose combined weight exceeds 1000
 *
 * @param {string} pattern
 * @param {number} [maxLength]
 * @param {object} [meta] error metadata (field, lookup)
 */
export function assertSafeRegex(pattern, maxLength = 200, meta = {}) {
  const fail = (message, code) => new InvalidValueError(message, { lookup: 'regex', ...meta, value: pattern, code });

  if (pattern.length > maxLength) {
    throw fail(`Regular expression exceeds ${maxLength} characters`, 'unsafe_regex');
  }
  try {
    new RegExp(pattern);
  } catch {
    throw fail('Invalid regular expression', 'invalid_regex');
  }

  const stack = [0];
  let last = 0;
  const note = (w) => {
    stack[stack.length - 1] = Math.max(stack[stack.length - 1], w);
  };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i += 1;
      if (/[1-9]/.test(pattern[i] ?? '')) throw fail('Back-references are not allowed', 'unsafe_regex');
      last = 1;
      note(1);
    } else if (c === '[') {
      let j = i + 1;
      if (pattern[j] === '^') j += 1;
      if (pattern[j] === ']') j += 1;
      while (j < pattern.length && pattern[j] !== ']') j += pattern[j] === '\\' ? 2 : 1;
      i = j;
      last = 1;
      note(1);
    } else if (c === '(') {
      stack.push(0);
      last = 0;
    } else if (c === ')') {
      last = Math.max(stack.pop(), 1);
      note(last);
    } else if (c === '{' && /^\{\d+(,\d*)?\}/.test(pattern.slice(i))) {
      const [token, lo, rest] = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i));
      const hi = rest === undefined || rest === '' ? Number(lo) : Number(rest);
      if (Number(lo) > PG_MAX_REPETITION || hi > PG_MAX_REPETITION) {
        throw fail(`Repetition counts above ${PG_MAX_REPETITION} are not allowed`, 'unsafe_regex');
      }
      last = Math.max(last, 1) * Math.max(hi, 1);
      if (last > MAX_REPETITION_WEIGHT) {
        throw fail('Regular expression is too complex (nested bounded repetition)', 'unsafe_regex');
      }
      note(last);
      i += token.length - 1;
    } else if (c !== '*' && c !== '+' && c !== '?') {
      last = 1;
      note(1);
    }
  }
}

const SIMPLE_OPS = {
  exact: Op.eq,
  gt: Op.gt,
  gte: Op.gte,
  lt: Op.lt,
  lte: Op.lte,
  in: Op.in,
  range: Op.between,
};

const PATTERNS = {
  iexact: [Op.iLike, (v) => escapeLike(v)],
  contains: [Op.like, (v) => `%${escapeLike(v)}%`],
  icontains: [Op.iLike, (v) => `%${escapeLike(v)}%`],
  startswith: [Op.like, (v) => `${escapeLike(v)}%`],
  istartswith: [Op.iLike, (v) => `${escapeLike(v)}%`],
  endswith: [Op.like, (v) => `%${escapeLike(v)}`],
  iendswith: [Op.iLike, (v) => `%${escapeLike(v)}`],
};

/**
 * SQL expression for a transform applied to a column reference.
 * Datetime columns are first converted to wall time in `timeZone`, as Django
 * does with `AT TIME ZONE` when USE_TZ is on.
 */
function transformExpression(sql, transform, ref, columnType, timeZone) {
  const source = columnType === 'datetime' && timeZone ? sql.fn('timezone', timeZoneSqlArg(timeZone, sql), ref) : ref;
  if (transform === 'date') return sql.cast(source, 'date');
  if (transform === 'time') return sql.cast(source, 'time');
  if (transform === 'second') return sql.fn('floor', sql.fn('date_part', 'second', source));
  return sql.fn('date_part', DATE_PART[transform], source);
}

/**
 * @typedef {object} ColumnRef
 * @property {string} key       where-object key (column name, or `$path$`)
 * @property {object} ref       Sequelize.col(...) for use inside functions
 * @property {string} [type]    column type: 'datetime' | 'date' | 'time' | ...
 * @property {boolean} [castText] cast to text for text lookups (non-text columns)
 */

/**
 * Build a Sequelize where fragment for a column, a parsed lookup and an
 * already-coerced value.
 * @param {ColumnRef} column
 * @param {ParsedLookup} parsed
 * @param {unknown} value
 * @param {{ sql?: typeof Bundled, regexMaxLength?: number, timeZone?: object, searchConfig?: string|null, meta?: object }} [options]
 *   `sql` is the application's Sequelize class (see sequelize/sql.js)
 */
export function buildCondition(column, parsed, value, options = {}) {
  const { key, ref } = column;
  const sql = options.sql ?? Bundled;

  if (parsed.transform) {
    const expr = transformExpression(sql, parsed.transform, ref, column.type, options.timeZone);
    let v = value;
    if (parsed.transform === 'week_day') {
      // Django 1 = Sunday; PostgreSQL DOW 0 = Sunday.
      v = Array.isArray(v) ? v.map((x) => x - 1) : v - 1;
    }
    return sql.where(expr, { [SIMPLE_OPS[parsed.op]]: v });
  }

  const { op } = parsed;
  if (op === 'isnull') {
    return { [key]: value ? { [Op.is]: null } : { [Op.not]: null } };
  }
  if (op in SIMPLE_OPS) {
    if (op === 'exact' && value === null) return { [key]: { [Op.is]: null } };
    if (column.castText) return sql.where(sql.cast(ref, 'text'), { [SIMPLE_OPS[op]]: value });
    return { [key]: { [SIMPLE_OPS[op]]: value } };
  }

  const text = String(value);
  const target = column.castText ? sql.cast(ref, 'text') : ref;
  if (op === 'search') {
    const config = options.searchConfig ? [options.searchConfig] : [];
    return sql.where(sql.fn('to_tsvector', ...config, target), '@@', sql.fn('plainto_tsquery', ...config, text));
  }

  let comparison;
  if (op === 'regex' || op === 'iregex') {
    assertSafeRegex(text, options.regexMaxLength, { lookup: op, ...options.meta });
    comparison = { [op === 'regex' ? Op.regexp : Op.iRegexp]: text };
  } else {
    const [operator, pattern] = PATTERNS[op];
    comparison = { [operator]: pattern(text) };
  }
  return column.castText ? sql.where(target, comparison) : { [key]: comparison };
}

/**
 * Public helper for custom backends: a root-level condition on an attribute.
 * @param {string} column attribute / column name
 * @param {string} lookup e.g. 'icontains', 'year__gte'
 * @param {unknown} value already-coerced value
 * @param {{ model?: object, regexMaxLength?: number, timeZone?: object, columnType?: string, castText?: boolean }} [options]
 *   pass `model` so SQL expressions are built with the application's Sequelize
 */
export function buildLookupCondition(column, lookup, value, options = {}) {
  const parsed = parseLookup(lookup);
  if (!parsed) throw new ConfigurationError(`Unknown lookup "${lookup}"`);
  const sql = options.model?.sequelize?.constructor ?? Bundled;
  return buildCondition(
    { key: column, ref: sql.col(column), type: options.columnType, castText: options.castText },
    parsed,
    value,
    { ...options, sql },
  );
}

/** DRF `SearchFilter.lookup_prefixes`. */
export const SEARCH_PREFIXES = Object.freeze({
  '^': 'istartswith',
  '=': 'iexact',
  $: 'iregex',
  '@': 'search',
});
