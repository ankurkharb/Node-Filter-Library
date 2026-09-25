/**
 * FilterSet definition — the JavaScript equivalent of a django-filter FilterSet.
 *
 * Two ways to declare a filter, matching django-filter's two mechanisms:
 *
 * - `lookups: [...]` generates one param per lookup, like `Meta.fields`
 *   dict form: `age` (exact), `age__gte`, `age__lte`. There is no `age__exact`.
 * - `lookup: 'gte'` (or neither) declares a single filter whose param is the
 *   key itself, like `age = NumberFilter(lookup_expr='gte')` → `?age=`.
 */

import { DEFAULT_LOOKUP, parseLookup } from '../lookups/index.js';
import { ConfigurationError } from '../errors/index.js';

const FILTER_SET = Symbol('node-query-filter.FilterSet');

export const FIELD_TYPES = new Set([
  'auto',
  'string',
  'char',
  'integer',
  'number',
  'float',
  'decimal',
  'boolean',
  'uuid',
  'date',
  'datetime',
  'time',
  'choice',
  'multipleChoice',
  'modelChoice',
  'modelMultipleChoice',
  'range',
  'dateFromToRange',
  'datetimeFromToRange',
  'custom',
]);

/** Types whose params are fixed by the type itself (django-filter widgets). */
export const WIDGET_TYPES = Object.freeze({
  range: ['min', 'max'],
  dateFromToRange: ['after', 'before'],
  datetimeFromToRange: ['after', 'before'],
});

/** `valueType` choices for a `range` filter. */
const RANGE_VALUE_TYPES = ['integer', 'float', 'decimal'];

/** Types that read every value of a repeated param (`?status=a&status=b`). */
export const LIST_TYPES = new Set(['multipleChoice', 'modelMultipleChoice']);

const DEF_KEYS = new Set([
  'type',
  'lookups',
  'lookup',
  'field',
  'attribute',
  'path',
  'associationPath',
  'choices',
  'method',
  'filter',
  'exclude',
  'strip',
  'allowEmpty',
  'conjoined',
  'nullValue',
  'queryset',
  'valueType',
]);

/**
 * @param {string} key
 * @param {object|true|string[]} def
 */
function normalizeFieldDef(key, def) {
  if (def === true) def = { lookups: [DEFAULT_LOOKUP] };
  if (Array.isArray(def)) def = { lookups: def };
  if (typeof def !== 'object' || def === null) {
    throw new ConfigurationError(`Filter "${key}": definition must be an object, an array of lookups, or true`);
  }

  for (const k of Object.keys(def)) {
    if (!DEF_KEYS.has(k)) {
      throw new ConfigurationError(`Filter "${key}": unknown option "${k}"`, { field: key, option: k });
    }
  }

  const type = def.type ?? 'auto';
  if (!FIELD_TYPES.has(type)) {
    throw new ConfigurationError(`Filter "${key}": unknown type "${type}"`);
  }
  if (def.lookup !== undefined && def.lookups !== undefined) {
    throw new ConfigurationError(
      `Filter "${key}": use "lookup" (one param named "${key}") or "lookups" (one param per lookup), not both`,
    );
  }

  const special = type in WIDGET_TYPES || LIST_TYPES.has(type);
  if (special && (def.lookup !== undefined || def.lookups !== undefined)) {
    throw new ConfigurationError(`Filter "${key}": type "${type}" does not take lookups`);
  }

  let lookups;
  let declared;
  if (def.lookups !== undefined) {
    if (!Array.isArray(def.lookups) || def.lookups.length === 0) {
      throw new ConfigurationError(`Filter "${key}": "lookups" must be a non-empty array`);
    }
    lookups = [...new Set(def.lookups)];
    declared = false;
  } else {
    lookups = [def.lookup ?? DEFAULT_LOOKUP];
    declared = true;
  }
  for (const lu of lookups) {
    if (lu !== '__all__' && !parseLookup(lu)) {
      throw new ConfigurationError(`Filter "${key}": unknown lookup "${lu}"`);
    }
  }

  if ((type === 'choice' || type === 'multipleChoice') && (!Array.isArray(def.choices) || def.choices.length === 0)) {
    throw new ConfigurationError(`Filter "${key}": type "${type}" requires a non-empty "choices" array`);
  }

  const method = def.method ?? def.filter ?? null;
  if (method !== null && typeof method !== 'function') {
    throw new ConfigurationError(`Filter "${key}": "method" must be a function`);
  }
  if (type === 'custom' && !method) {
    throw new ConfigurationError(`Filter "${key}": type "custom" requires a "method" function`);
  }
  if (def.queryset !== undefined && typeof def.queryset !== 'function') {
    throw new ConfigurationError(`Filter "${key}": "queryset" must be a function returning a where object`);
  }
  if (def.valueType !== undefined && type !== 'range') {
    throw new ConfigurationError(`Filter "${key}": "valueType" only applies to type "range"`);
  }
  if (def.valueType !== undefined && !RANGE_VALUE_TYPES.includes(def.valueType)) {
    throw new ConfigurationError(
      `Filter "${key}": "valueType" must be one of ${RANGE_VALUE_TYPES.map((t) => `"${t}"`).join(', ')}`,
    );
  }

  // Path: explicit, or taken from a `rel__field` key.
  let path = def.path ?? def.associationPath ?? null;
  if (typeof path === 'string') path = path.split('__').filter(Boolean);
  let attribute = def.field ?? def.attribute ?? null;
  if (!attribute) {
    const parts = key.split('__');
    attribute = parts[parts.length - 1];
    if (!path && parts.length > 1) path = parts.slice(0, -1);
  }

  return Object.freeze({
    key,
    type,
    lookups: Object.freeze(lookups),
    declared,
    attribute,
    path: path && path.length > 0 ? Object.freeze([...path]) : null,
    choices: def.choices ? Object.freeze([...def.choices]) : null,
    method,
    exclude: Boolean(def.exclude),
    strip: def.strip !== false,
    allowEmpty: Boolean(def.allowEmpty),
    conjoined: Boolean(def.conjoined),
    nullValue: def.nullValue ?? null,
    queryset: def.queryset ?? null,
    valueType: def.valueType ?? null,
  });
}

/**
 * Expand the `filterFields` shorthand (DRF `filterset_fields`). Filter types
 * are inferred from the model (type `'auto'`), as django-filter does.
 *
 * @param {string[] | Record<string, string[]|true|object>} filterFields
 * @returns {Record<string, object>}
 */
export function expandFilterFields(filterFields) {
  const fields = {};
  if (Array.isArray(filterFields)) {
    for (const name of filterFields) fields[name] = { lookups: [DEFAULT_LOOKUP] };
    return fields;
  }
  if (filterFields && typeof filterFields === 'object') {
    for (const [name, spec] of Object.entries(filterFields)) {
      if (spec === true) fields[name] = { lookups: [DEFAULT_LOOKUP] };
      else if (Array.isArray(spec)) fields[name] = { lookups: spec };
      else fields[name] = spec;
    }
    return fields;
  }
  throw new ConfigurationError('filterFields must be an array of field names or an object of field → lookups');
}

/**
 * Define a FilterSet.
 *
 * ```js
 * defineFilterSet({ age: { type: 'integer', lookups: ['exact', 'gte'] } })
 * defineFilterSet({ filterFields: ['status'], fields: { age: { lookup: 'gte' } } })
 * ```
 *
 * @param {Record<string, object>} config
 */
export function defineFilterSet(config = {}) {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new ConfigurationError('defineFilterSet expects an object');
  }
  const keys = Object.keys(config);
  const structured = keys.length > 0 && keys.every((k) => k === 'fields' || k === 'filterFields');
  const raw = structured
    ? { ...(config.filterFields ? expandFilterFields(config.filterFields) : {}), ...(config.fields || {}) }
    : config;

  /** @type {Map<string, ReturnType<typeof normalizeFieldDef>>} */
  const fields = new Map();
  for (const [key, def] of Object.entries(raw)) fields.set(key, normalizeFieldDef(key, def));

  return Object.freeze({
    [FILTER_SET]: true,
    fields,
    /** @param {string} key */
    get(key) {
      return fields.get(key);
    },
    keys() {
      return [...fields.keys()];
    },
  });
}

/** @param {unknown} value */
export function isFilterSet(value) {
  return Boolean(value && value[FILTER_SET]);
}
