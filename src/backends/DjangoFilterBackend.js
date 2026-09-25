/**
 * DjangoFilterBackend — applies a FilterSet to the query params.
 *
 * Mirrors django-filter: every declared filter reads its own param(s); params
 * that are not filter params are ignored; all values are validated first
 * (`filterset.is_valid()`), and only then are the filters applied, each as a
 * separate condition ANDed onto the query.
 */

import { Op } from 'sequelize';
import { BaseFilterBackend } from './BaseFilterBackend.js';
import { allValues, lastValue, normalizeQuery } from '../parser/index.js';
import { coerceValue, splitCsv } from '../filters/coerce.js';
import { isKnownLookup, lookupValueType, parseLookup } from '../lookups/index.js';
import { bindFilterSet } from '../core/bind.js';
import { andWhere, preservesConditions } from '../core/queryState.js';
import { evaluateQueryset, filterCondition, rejectThenable } from '../sequelize/filterCondition.js';
import { zonedTimeToInstant } from '../filters/timezone.js';
import {
  ConfigurationError,
  FilterValidationError,
  InvalidLookupError,
  InvalidValueError,
  SecurityLimitError,
  UnknownFilterError,
  UnsupportedLookupError,
} from '../errors/index.js';

const GTE = parseLookup('gte');
const LTE = parseLookup('lte');
const LT = parseLookup('lt');
const RANGE = parseLookup('range');
const EXACT = parseLookup('exact');
const IN = parseLookup('in');
const ISNULL = parseLookup('isnull');

export class DjangoFilterBackend extends BaseFilterBackend {
  apply(context) {
    const { filterSet, queryState, model, security } = context;
    if (!filterSet) return queryState;

    const params = normalizeQuery(context.query);
    const bound = bindFilterSet(filterSet, model);
    this.checkUnknownParams(params, bound, context);

    const pending = [];
    const errors = [];
    for (const entry of bound.entries) {
      let result;
      try {
        result = this.evaluate(entry, params, context);
      } catch (err) {
        if (err instanceof FilterValidationError) {
          errors.push(err);
          continue;
        }
        throw err;
      }
      if (result === undefined) continue;
      pending.push(result);
      if (pending.length > security.maxFilters) {
        throw new SecurityLimitError(`Too many filters (max ${security.maxFilters})`, {
          details: { maxFilters: security.maxFilters },
        });
      }
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new FilterValidationError(`${errors.length} filter values are invalid`, {
        code: 'invalid_filters',
        details: { errors: errors.map((e) => e.toJSON()) },
      });
    }

    for (const result of pending) this.applyResult(result, context);
    return queryState;
  }

  /** Only active with `unknownFilterBehavior: 'error'`; django-filter itself ignores unknown params. */
  checkUnknownParams(params, bound, context) {
    const { config } = context;
    if (config.unknownFilterBehavior !== 'error') return;
    const reserved = new Set([config.searchParam, config.orderingParam, ...config.reservedParams]);
    for (const name of Object.keys(params)) {
      if (bound.paramIndex.has(name) || reserved.has(name)) continue;
      for (const filter of bound.filters) {
        if (!name.startsWith(`${filter.key}__`)) continue;
        const suffix = name.slice(filter.key.length + 2);
        if (isKnownLookup(suffix)) {
          throw new InvalidLookupError(`Lookup "${suffix}" is not enabled for filter "${filter.key}"`, {
            field: filter.key,
            lookup: suffix,
          });
        }
        throw new UnsupportedLookupError(`"${suffix}" is not a lookup`, { field: filter.key, lookup: suffix });
      }
      throw new UnknownFilterError(`Unknown filter parameter: ${name}`, { field: name });
    }
  }

  coerce(type, raw, filter, meta, context) {
    return coerceValue(type, raw, { choices: filter.choices, strip: filter.def.strip }, meta, {
      timeZone: context.timeZone,
      strictBooleans: context.config.strictBooleans,
    });
  }

  /**
   * Validate one filter's input.
   * @returns {undefined | { filter: object, parts?: object[], combine?: string, separate?: object[][], method?: true, value?: unknown, lookup?: string }}
   */
  evaluate(entry, params, context) {
    if (entry.kind === 'widget') return this.evaluateWidget(entry, params, context);
    if (entry.kind === 'list') return this.evaluateList(entry, params, context);

    const raw = lastValue(params[entry.params[0]]);
    if (raw === undefined) return undefined;
    const { filter, lookup: parsed } = entry;
    const meta = { field: entry.params[0], lookup: parsed.name };

    if (filter.type === 'custom') {
      if (raw === '' && !filter.def.allowEmpty) return undefined;
      return { filter, method: true, value: raw, lookup: parsed.name };
    }

    const type = lookupValueType(parsed, filter.valueType);
    let value;

    if (parsed.op === 'in' || parsed.op === 'range') {
      const tokens = splitCsv(raw);
      if (tokens.length === 0) return undefined;
      if (parsed.op === 'in' && tokens.length > context.security.maxInValues) {
        throw new SecurityLimitError(`Too many values for ${entry.params[0]} (max ${context.security.maxInValues})`, {
          ...meta,
          details: { maxInValues: context.security.maxInValues },
        });
      }
      if (parsed.op === 'range' && tokens.length !== 2) {
        throw new InvalidValueError('Range query expects two values.', { ...meta, value: raw });
      }
      // An empty token is '' for text/choices and NULL otherwise: IN (x, NULL)
      // never matches NULL and BETWEEN x AND NULL matches nothing, as in Django.
      value = tokens.map((t) => (type === 'choice' && t === '' ? '' : this.coerce(type, t, filter, meta, context)));
      if (parsed.op === 'in') {
        value = [...new Map(value.filter((v) => v !== null).map((v) => [signature(v), v])).values()];
      }
    } else if (filter.def.nullValue !== null && raw === filter.def.nullValue && parsed.op === 'exact') {
      value = null;
    } else if (type === 'string' && filter.def.allowEmpty && raw === '') {
      value = '';
    } else {
      value = this.coerce(type, raw, filter, meta, context);
      if (value === null || value === '') return undefined;
    }

    if (filter.def.method) return { filter, method: true, value, lookup: parsed.name };
    this.deferModelChoiceCheck(filter, parsed, value, meta, context);
    return { filter, parts: [{ parsed, value }] };
  }

  /** MultipleChoiceFilter / ModelMultipleChoiceFilter: every value of a repeated param. */
  evaluateList(entry, params, context) {
    const raws = allValues(params[entry.params[0]]);
    if (raws.length === 0) return undefined;
    const { filter } = entry;
    const meta = { field: entry.params[0] };
    const nullValue = filter.def.nullValue;

    let includesNull = false;
    const values = [];
    for (const raw of raws) {
      if (nullValue !== null && raw === nullValue) {
        includesNull = true;
        continue;
      }
      // Unlike single-value filters, an empty value here is validated (and rejected) like any other.
      const v = raw === '' ? null : this.coerce(filter.valueType, raw, filter, meta, context);
      if (v === null) {
        const message = `Select a valid choice. ${raw} is not one of the available choices.`;
        throw new InvalidValueError(message, { ...meta, value: raw });
      }
      values.push(v);
    }

    if (filter.def.method) return { filter, method: true, value: raws, lookup: 'in' };
    if (filter.type === 'modelMultipleChoice') this.deferModelChoiceCheck(filter, IN, values, meta, context);

    if (filter.def.conjoined) {
      const separate = values.map((v) => [{ parsed: EXACT, value: v }]);
      if (includesNull) separate.push([{ parsed: ISNULL, value: true }]);
      return { filter, separate };
    }
    const parts = [];
    if (values.length > 0) parts.push({ parsed: IN, value: values });
    if (includesNull) parts.push({ parsed: ISNULL, value: true });
    return { filter, parts, combine: 'or' };
  }

  /** RangeFilter (`_min`/`_max`) and Date(Time)FromToRangeFilter (`_after`/`_before`). */
  evaluateWidget(entry, params, context) {
    const { filter } = entry;
    const [lowParam, highParam] = entry.params;
    const meta = { field: filter.key };
    const errors = [];
    const read = (param) => {
      try {
        return this.coerce(filter.valueType, lastValue(params[param]) ?? null, filter, meta, context);
      } catch (err) {
        errors.push(err);
        return null;
      }
    };
    const low = read(lowParam);
    const high = read(highParam);
    if (errors.length > 0) throw errors[0];
    if (low === null && high === null) return undefined;
    if (filter.def.method) return { filter, method: true, value: { start: low, stop: high } };

    if (filter.type === 'dateFromToRange' && filter.columnType === 'datetime') {
      // Django: start of the first day to end of the last day, in the current time zone.
      const parts = [];
      if (low !== null) parts.push({ parsed: GTE, value: this.dayStart(low, 0, meta, context) });
      if (high !== null) parts.push({ parsed: LT, value: this.dayStart(high, 1, meta, context) });
      return { filter, parts };
    }
    if (low !== null && high !== null) return { filter, parts: [{ parsed: RANGE, value: [low, high] }] };
    return { filter, parts: [low !== null ? { parsed: GTE, value: low } : { parsed: LTE, value: high }] };
  }

  /** Midnight at the start of `date` + `addDays`, in the filtering time zone. */
  dayStart(date, addDays, meta, context) {
    const [y, m, d] = date.split('-').map(Number);
    // Set year, month and day together so a day past the month or year end
    // rolls over into the right year (and years below 100 are not remapped).
    const next = new Date(0);
    next.setUTCFullYear(y, m - 1, d + addDays);
    const result = zonedTimeToInstant(
      { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
      context.timeZone,
    );
    if ('error' in result) {
      throw new InvalidValueError(`${date} couldn't be interpreted in time zone ${context.timeZone.name}`, {
        ...meta,
        value: date,
        code: 'ambiguous_timezone',
      });
    }
    return result.date;
  }

  /**
   * ModelChoiceFilter rejects a primary key that does not exist (or is outside
   * `queryset`). That needs a query, so it runs only in `applyAsync()`; the
   * synchronous `apply()` enforces `queryset` in SQL instead, and an unknown
   * key simply matches nothing.
   */
  deferModelChoiceCheck(filter, parsed, value, meta, context) {
    if (!filter.relationKey || !context.deferred || !context.model) return;
    if (parsed.op !== 'exact' && parsed.op !== 'in') return;
    const values = (Array.isArray(value) ? value : [value]).filter((v) => v !== null);
    if (values.length === 0) return;
    const target = filter.associations[filter.associations.length - 1].target;
    const pk = target.primaryKeyAttribute;
    context.deferred.push(async () => {
      const where = { [pk]: { [Op.in]: values } };
      const scoped = filter.def.queryset ? { [Op.and]: [where, evaluateQueryset(filter, context)] } : where;
      const found = await target.count({ where: scoped });
      if (found !== new Set(values.map(signature)).size) {
        throw new InvalidValueError('Select a valid choice. That choice is not one of the available choices.', {
          ...meta,
          value,
        });
      }
    });
  }

  applyResult(result, context) {
    const { filter } = result;
    const { queryState } = context;
    if (result.method) {
      const before = queryState.where;
      const returned = filter.def.method({
        value: result.value,
        name: filter.key,
        field: filter.key,
        lookup: result.lookup,
        queryState,
        context,
        model: context.model,
        andWhere: (condition) => andWhere(queryState, condition),
      });
      // A method adds conditions with andWhere() and runs synchronously. A
      // returned condition or promise would otherwise be silently ignored.
      rejectThenable(
        returned,
        `Filter "${filter.key}": method must be synchronous (it returned a promise); add conditions with andWhere()`,
      );
      if (returned !== undefined && returned !== queryState) {
        throw new ConfigurationError(
          `Filter "${filter.key}": method returned a value, which is not applied; add conditions with andWhere() and return nothing`,
        );
      }
      if (!preservesConditions(before, queryState.where)) {
        throw new ConfigurationError(
          `Filter "${filter.key}": method replaced existing where conditions; add conditions with andWhere()`,
        );
      }
      return;
    }
    if (result.separate) {
      for (const parts of result.separate) andWhere(queryState, filterCondition(filter, parts, context));
      return;
    }
    andWhere(queryState, filterCondition(filter, result.parts, context, { combine: result.combine }));
  }
}

function signature(v) {
  return v instanceof Date ? `d:${v.getTime()}` : `${typeof v}:${v}`;
}

export default DjangoFilterBackend;
