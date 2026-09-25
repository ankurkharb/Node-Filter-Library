/**
 * Binding: resolve a FilterSet against a Sequelize model once, and cache it.
 *
 * Binding validates the configuration (every path, attribute and lookup must
 * exist), infers `'auto'` types from the model, and builds the index of
 * accepted query params. Any problem is a ConfigurationError.
 */

import { ConfigurationError } from '../errors/index.js';
import { ALL_LOOKUPS, TRANSFORMS_FOR_TYPE, parseLookup } from '../lookups/index.js';
import { normalizeChoices } from '../filters/coerce.js';
import {
  columnOf,
  getAssociation,
  getAttribute,
  inferFilterType,
  isTextColumn,
  resolveAssociationPath,
} from '../sequelize/model.js';
import { LIST_TYPES, WIDGET_TYPES } from './filterset.js';

const NO_MODEL = {};
/** @type {WeakMap<object, WeakMap<object, ReturnType<typeof build>>>} */
const cache = new WeakMap();

const MODEL_CHOICE_TYPES = new Set(['modelChoice', 'modelMultipleChoice']);
const NUMERIC_TYPES = new Set(['integer', 'float', 'decimal']);

/**
 * @param {ReturnType<import('./filterset.js').defineFilterSet>} filterSet
 * @param {object|null|undefined} model
 */
export function bindFilterSet(filterSet, model) {
  let perSet = cache.get(filterSet);
  if (!perSet) {
    perSet = new WeakMap();
    cache.set(filterSet, perSet);
  }
  const key = model || NO_MODEL;
  let bound = perSet.get(key);
  if (!bound) {
    bound = build(filterSet, model || null);
    perSet.set(key, bound);
  }
  return bound;
}

function build(filterSet, model) {
  const filters = [];
  const entries = [];
  /** @type {Map<string, object>} */
  const paramIndex = new Map();

  for (const def of filterSet.fields.values()) {
    const filter = bindFilter(def, model);
    filters.push(filter);
    for (const entry of entriesFor(filter)) {
      entries.push(entry);
      for (const param of entry.params) {
        const other = paramIndex.get(param);
        if (other) {
          throw new ConfigurationError(
            `Filters "${other.filter.key}" and "${filter.key}" both use the query parameter "${param}"`,
          );
        }
        paramIndex.set(param, entry);
      }
    }
  }
  return { filters, entries, paramIndex };
}

/** Every lookup meaningful for a filter, for `lookups: ['__all__']`. */
function allLookupsFor(columnType) {
  const transforms = TRANSFORMS_FOR_TYPE[columnType] ?? new Set();
  return [...ALL_LOOKUPS].filter((name) => {
    const parsed = parseLookup(name);
    if (parsed.op === 'search') return false;
    return !parsed.transform || transforms.has(parsed.transform);
  });
}

function bindFilter(def, model) {
  const where = `Filter "${def.key}"`;
  let associations = [];
  let target = model;
  let attrInfo = null;
  let relationKey = false;

  if (model) {
    if (def.path) ({ associations, target } = resolveAssociationPath(model, def.path, where));
    attrInfo = getAttribute(target, def.attribute);
    if (!attrInfo) {
      const assoc = getAssociation(target, def.attribute);
      if (assoc && (def.type === 'auto' || MODEL_CHOICE_TYPES.has(def.type))) {
        // `?company=3` — a ModelChoiceFilter on the related primary key.
        associations = [...associations, assoc];
        target = assoc.target;
        attrInfo = getAttribute(target, target.primaryKeyAttribute);
        relationKey = true;
      } else if (def.type === 'auto' && def.method) {
        throw new ConfigurationError(`${where}: declare a "type" for a method filter that is not a model attribute`);
      } else if (def.type !== 'custom' && !def.method) {
        throw new ConfigurationError(`${where}: ${target.name} has no attribute or association "${def.attribute}"`);
      }
    }
  }

  if (MODEL_CHOICE_TYPES.has(def.type) && model && !relationKey) {
    throw new ConfigurationError(`${where}: type "${def.type}" must name an association`);
  }
  if (def.queryset && !(relationKey || MODEL_CHOICE_TYPES.has(def.type))) {
    throw new ConfigurationError(`${where}: "queryset" only applies to model choice filters`);
  }

  const inferred = attrInfo ? inferFilterType(attrInfo.def) : null;
  let type = def.type;
  if (type === 'auto') type = relationKey ? 'modelChoice' : (inferred?.type ?? 'string');
  if (type === 'char') type = 'string';

  let choices = def.choices ? normalizeChoices(def.choices) : null;
  if ((type === 'choice' || type === 'multipleChoice') && !choices) choices = inferred?.choices ?? null;
  if ((type === 'choice' || type === 'multipleChoice') && (!choices || choices.length === 0)) {
    throw new ConfigurationError(`${where}: no choices available (declare "choices")`);
  }

  // The type values are coerced to.
  let valueType;
  switch (type) {
    case 'modelChoice':
    case 'modelMultipleChoice':
      valueType = inferred?.type ?? 'string';
      break;
    case 'multipleChoice':
      valueType = 'choice';
      break;
    case 'number':
      // NumberFilter parses a Decimal; an integer column then truncates it.
      valueType = inferred?.type === 'integer' ? 'integer' : 'decimal';
      break;
    case 'range':
      valueType = def.valueType ?? (NUMERIC_TYPES.has(inferred?.type) ? inferred.type : 'decimal');
      break;
    case 'dateFromToRange':
      valueType = 'date';
      break;
    case 'datetimeFromToRange':
      valueType = 'datetime';
      break;
    case 'custom':
      valueType = null;
      break;
    default:
      valueType = type;
  }

  // The column's storage type (decides transforms and date-range bounds).
  const columnType =
    inferred?.type ?? (type === 'dateFromToRange' || type === 'datetimeFromToRange' ? 'datetime' : valueType);

  let lookups = null;
  if (!(type in WIDGET_TYPES) && !LIST_TYPES.has(type)) {
    lookups = def.lookups.includes('__all__') ? allLookupsFor(columnType) : [...def.lookups];
    if (type !== 'custom') {
      for (const name of lookups) {
        const parsed = parseLookup(name);
        if (parsed.transform && !TRANSFORMS_FOR_TYPE[columnType]?.has(parsed.transform)) {
          throw new ConfigurationError(`${where}: lookup "${name}" is not available on a ${columnType} column`);
        }
      }
    }
  }

  return Object.freeze({
    key: def.key,
    def,
    type,
    valueType,
    columnType,
    choices,
    lookups,
    associations,
    target,
    attribute: attrInfo?.name ?? def.attribute,
    column: attrInfo ? columnOf(target, attrInfo.name) : def.attribute,
    nullable: attrInfo ? attrInfo.def.allowNull !== false : true,
    textColumn: isTextColumn(attrInfo?.def, valueType),
    relationKey,
  });
}

function entriesFor(filter) {
  const { key, type } = filter;
  if (type in WIDGET_TYPES) {
    return [{ filter, kind: 'widget', lookup: null, params: WIDGET_TYPES[type].map((s) => `${key}_${s}`) }];
  }
  if (LIST_TYPES.has(type)) {
    return [{ filter, kind: 'list', lookup: parseLookup('in'), params: [key] }];
  }
  if (filter.def.declared) {
    return [{ filter, kind: 'single', lookup: parseLookup(filter.lookups[0]), params: [key] }];
  }
  return filter.lookups.map((name) => ({
    filter,
    kind: 'single',
    lookup: parseLookup(name),
    params: [name === 'exact' ? key : `${key}__${name}`],
  }));
}

/**
 * Which filter and lookup a query param maps to, or null if it is not a
 * filter param (and would be ignored).
 * @param {string} paramName
 * @param {ReturnType<import('./filterset.js').defineFilterSet>} filterSet
 * @param {object} [model]
 * @returns {{ key: string, lookup: string|null, filter: object } | null}
 */
export function resolveFilterParam(paramName, filterSet, model) {
  const entry = bindFilterSet(filterSet, model).paramIndex.get(paramName);
  return entry ? { key: entry.filter.key, lookup: entry.lookup?.name ?? null, filter: entry.filter } : null;
}
