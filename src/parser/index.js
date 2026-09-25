/**
 * Query-parameter parsing, framework-agnostic.
 *
 * Django's `QueryDict.get()` returns the LAST value of a repeated param, and
 * that is what DRF and django-filter read for every single-valued param
 * (filters, `search`, `ordering`). Only multiple-choice filters read all
 * values (`getlist`).
 */

/**
 * Normalize Express/Fastify/Koa `req.query`, a `URLSearchParams`, or a raw
 * query string into `{ name: string | string[] }`.
 *
 * Nested objects (e.g. qs-parsed `?age[gte]=1`) are not valid filter input and
 * are dropped.
 *
 * @param {object|URLSearchParams|string|null|undefined} input
 * @returns {Record<string, string|string[]>}
 */
export function normalizeQuery(input) {
  /** @type {Record<string, string|string[]>} */
  const out = {};
  const set = (key, value) => {
    // defineProperty so a key like "__proto__" is stored as data, never as a prototype.
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  };

  if (input == null) return out;
  if (typeof input === 'string') {
    return normalizeQuery(new URLSearchParams(input.startsWith('?') ? input.slice(1) : input));
  }
  if (input instanceof URLSearchParams) {
    for (const key of new Set(input.keys())) {
      const values = input.getAll(key);
      set(key, values.length === 1 ? values[0] : values);
    }
    return out;
  }
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      const values = value.filter(isScalar).map(String);
      if (values.length > 0) set(key, values.length === 1 ? values[0] : values);
    } else if (isScalar(value)) {
      set(key, String(value));
    }
  }
  return out;
}

function isScalar(v) {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * `QueryDict.get()`: the last value of a possibly repeated param.
 * @param {string|string[]|undefined} value
 * @returns {string|undefined}
 */
export function lastValue(value) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}

/**
 * `QueryDict.getlist()`.
 * @param {string|string[]|undefined} value
 * @returns {string[]}
 */
export function allValues(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// django.utils.text.smart_split_re
const SMART_SPLIT_RE = /((?:[^\s'"]*(?:(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')[^\s'"]*)+)|\S+)/g;

function unescapeStringLiteral(s) {
  const quote = s[0];
  return s.slice(1, -1).replaceAll(`\\${quote}`, quote).replaceAll('\\\\', '\\');
}

/** Index of the quote closing the one at `open` (honouring backslash escapes), or -1. */
function closingQuote(s, open) {
  for (let i = open + 1; i < s.length; i++) {
    if (s[i] === '\\') i += 1;
    else if (s[i] === s[open]) return i;
  }
  return -1;
}

/**
 * How SearchFilter splits `?search=`: on commas only. Whitespace inside a term
 * is kept (`rahul kumar` is one term); whitespace around each term is trimmed
 * (`rahul , kumar` gives `rahul` and `kumar`). Empty terms (`a,,b`, a leading
 * or trailing comma, whitespace only) are dropped.
 *
 * Quotes work as in DRF's `search_smart_split`: a term wrapped in matching
 * `"` or `'` is unquoted (`\"` and `\\` unescaped), and commas inside it are part
 * of the term (`"a,b"` is one term). An unmatched quote is literal text.
 * @param {string} value
 * @returns {string[]}
 */
export function splitSearchTerms(value) {
  if (!value) return [];
  const s = String(value);
  const terms = [];
  let start = 0;
  while (start <= s.length) {
    // A term that opens with a quote runs at least to its closing quote.
    const first = s.slice(start).search(/\S/) + start;
    const close = first >= start && (s[first] === '"' || s[first] === "'") ? closingQuote(s, first) : -1;
    const comma = s.indexOf(',', close === -1 ? start : close + 1);
    const end = comma === -1 ? s.length : comma;
    terms.push(s.slice(start, end).trim());
    start = end + 1;
  }
  return terms
    .map((term) =>
      (term.startsWith('"') || term.startsWith("'")) && term[0] === term[term.length - 1]
        ? unescapeStringLiteral(term)
        : term,
    )
    .filter((term) => term !== '');
}

/**
 * Port of DRF's `search_smart_split` (DRF 3.15+): split on whitespace keeping
 * quoted phrases together; unquoted tokens are further split on commas.
 * SearchFilter uses `splitSearchTerms` instead; override
 * `SearchFilter#getSearchTerms` with this function for DRF's splitting.
 * @param {string} value
 * @returns {string[]}
 */
export function searchSmartSplit(value) {
  if (!value) return [];
  const terms = [];
  for (const [bit] of String(value).matchAll(SMART_SPLIT_RE)) {
    const term = bit.replace(/^,+|,+$/g, '');
    if ((term.startsWith('"') || term.startsWith("'")) && term[0] === term[term.length - 1]) {
      terms.push(unescapeStringLiteral(term));
    } else {
      for (const sub of term.split(',')) {
        if (sub) terms.push(sub.trim());
      }
    }
  }
  return terms;
}

/**
 * Parse an `ordering` param (`-created_at,name`). Uses the last value of a
 * repeated param; terms are trimmed, empty terms dropped.
 * @param {string|string[]|undefined} raw
 * @returns {{ term: string, field: string, direction: 'ASC'|'DESC' }[]}
 */
export function parseOrdering(raw) {
  const value = lastValue(raw);
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((term) =>
      term.startsWith('-')
        ? { term, field: term.slice(1), direction: 'DESC' }
        : { term, field: term, direction: 'ASC' },
    );
}
