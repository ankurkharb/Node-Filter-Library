/**
 * createFiltering — the equivalent of a DRF view's filtering configuration
 * (`filter_backends`, `filterset_class`, `search_fields`, ...). Compose
 * backends and produce Sequelize find options.
 */

import { defineFilterSet, expandFilterFields, isFilterSet } from './filterset.js';
import { bindFilterSet } from './bind.js';
import { createQueryState, cloneQueryState, toSequelizeOptions } from './queryState.js';
import { DjangoFilterBackend } from '../backends/DjangoFilterBackend.js';
import { SearchFilter, compileSearchField } from '../backends/SearchFilter.js';
import { OrderingFilter, compileOrderingField } from '../backends/OrderingFilter.js';
import { ConfigurationError } from '../errors/index.js';
import { resolveTimeZone } from '../filters/timezone.js';
import { createAliasGenerator } from '../sequelize/relations.js';
import { parseOrdering } from '../parser/index.js';

/**
 * @typedef {object} FilterContext
 * @property {object} query            query params (object, URLSearchParams or string)
 * @property {object} [request]        original request, for custom backends and filters
 * @property {object} [model]          Sequelize model
 * @property {object|null} filterSet
 * @property {object} config
 * @property {object} security
 * @property {ReturnType<typeof createQueryState>} queryState
 * @property {object} [view]
 * @property {{ name: string, offsetMinutes: number|null }} timeZone
 * @property {{ next(): string }} aliases  subquery alias generator
 * @property {Array<() => Promise<void>>|null} deferred async validations (applyAsync only)
 */

const OPTIONS = new Set([
  'model',
  'filterSet',
  'filterFields',
  'searchFields',
  'getSearchFields',
  'orderingFields',
  'defaultOrdering',
  'ordering',
  'backends',
  'security',
  'searchParam',
  'orderingParam',
  'unknownFilterBehavior',
  'invalidOrderingBehavior',
  'reservedParams',
  'timeZone',
  'searchConfig',
  'strictBooleans',
  'view',
]);

export const DEFAULT_SECURITY = Object.freeze({
  maxInValues: 100,
  maxFilters: 50,
  maxRelationshipDepth: 3,
  maxSearchTerms: 20,
  regexMaxLength: 200,
});

/** Pagination params that never count as unknown filters (DRF's paginators). */
export const DEFAULT_RESERVED_PARAMS = Object.freeze(['page', 'page_size', 'limit', 'offset', 'cursor']);

function oneOf(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new ConfigurationError(`${name} must be one of ${allowed.map((a) => `"${a}"`).join(', ')}`);
  }
  return value;
}

function normalizeBackend(backend) {
  if (backend && typeof backend === 'object' && typeof backend.apply === 'function') return backend;
  if (typeof backend === 'function') {
    if (backend.prototype && typeof backend.prototype.apply === 'function') return new backend();
    // A plain function is a backend: (context) => queryState | void
    return { apply: backend };
  }
  throw new ConfigurationError(
    'Each backend must be a class with an apply(context) method, an instance of one, or a function (context) => queryState',
  );
}

function checkDepth(kind, name, depth, max) {
  if (depth > max) {
    throw new ConfigurationError(`${kind} "${name}" follows ${depth} relationships; maxRelationshipDepth is ${max}`);
  }
}

/**
 * @param {object} options see docs/CONFIGURATION.md
 */
export function createFiltering(options = {}) {
  for (const key of Object.keys(options)) {
    if (!OPTIONS.has(key)) throw new ConfigurationError(`Unknown createFiltering option "${key}"`);
  }
  if (options.filterSet && options.filterFields) {
    throw new ConfigurationError('Use either filterSet or filterFields, not both');
  }
  if (options.filterSet && !isFilterSet(options.filterSet)) {
    throw new ConfigurationError('filterSet must be created with defineFilterSet()');
  }
  if (options.defaultOrdering !== undefined && options.ordering !== undefined) {
    throw new ConfigurationError('Use either defaultOrdering or ordering (an alias), not both');
  }

  const filterSet =
    options.filterSet ||
    (options.filterFields ? defineFilterSet({ fields: expandFilterFields(options.filterFields) }) : null);

  const security = { ...DEFAULT_SECURITY };
  for (const [key, value] of Object.entries(options.security || {})) {
    if (!(key in DEFAULT_SECURITY)) throw new ConfigurationError(`Unknown security option "${key}"`);
    if (!Number.isInteger(value) || value < 0) {
      throw new ConfigurationError(`security.${key} must be a non-negative integer`);
    }
    security[key] = value;
  }
  Object.freeze(security);

  const searchFields = options.searchFields ?? [];
  const orderingFields = options.orderingFields ?? [];
  if (!Array.isArray(searchFields)) throw new ConfigurationError('searchFields must be an array');
  if (orderingFields !== '__all__' && !Array.isArray(orderingFields)) {
    throw new ConfigurationError('orderingFields must be an array or "__all__"');
  }
  const rawDefault = options.defaultOrdering ?? options.ordering ?? [];
  const defaultOrdering = parseOrdering((Array.isArray(rawDefault) ? rawDefault : [rawDefault]).join(','));

  const config = Object.freeze({
    searchFields,
    getSearchFields: options.getSearchFields,
    orderingFields,
    defaultOrdering,
    searchParam: options.searchParam ?? 'search',
    orderingParam: options.orderingParam ?? 'ordering',
    unknownFilterBehavior: oneOf('unknownFilterBehavior', options.unknownFilterBehavior ?? 'ignore', [
      'ignore',
      'error',
    ]),
    invalidOrderingBehavior: oneOf('invalidOrderingBehavior', options.invalidOrderingBehavior ?? 'ignore', [
      'ignore',
      'error',
    ]),
    reservedParams: options.reservedParams ?? DEFAULT_RESERVED_PARAMS,
    timeZone: options.timeZone !== undefined ? resolveTimeZone(options.timeZone) : null,
    searchConfig: options.searchConfig ?? null,
    strictBooleans: Boolean(options.strictBooleans),
  });

  if (options.getSearchFields !== undefined && typeof options.getSearchFields !== 'function') {
    throw new ConfigurationError('getSearchFields must be a function');
  }

  // Relationship depth limits apply to everything the developer configured.
  const max = security.maxRelationshipDepth;
  for (const def of filterSet?.fields.values() ?? []) checkDepth('Filter', def.key, def.path?.length ?? 0, max);
  for (const f of searchFields) checkDepth('Search field', f, f.replace(/^[\^=$@]/, '').split('__').length - 1, max);
  if (Array.isArray(orderingFields)) {
    for (const f of orderingFields) checkDepth('Ordering field', f, f.split('__').length - 1, max);
  }
  for (const { field } of defaultOrdering) checkDepth('Default ordering', field, field.split('__').length - 1, max);

  const backends = (options.backends ?? [DjangoFilterBackend, SearchFilter, OrderingFilter]).map(normalizeBackend);

  /** Validate the whole configuration against a model (cached per model). */
  const validated = new WeakSet();
  function validate(model) {
    if (!model || validated.has(model)) return;
    if (filterSet) bindFilterSet(filterSet, model);
    for (const f of searchFields) compileSearchField(f, model);
    if (Array.isArray(orderingFields)) for (const f of orderingFields) compileOrderingField(f, model);
    for (const { field } of defaultOrdering) compileOrderingField(field, model);
    validated.add(model);
  }
  validate(options.model);

  function run(input, deferred) {
    const model = input.model || options.model;
    validate(model);
    const query = input.query ?? input.request?.query ?? {};
    const timeZone = config.timeZone ?? resolveTimeZone(model?.sequelize?.options?.timezone ?? '+00:00');

    /** @type {FilterContext} */
    const context = {
      query,
      request: input.request,
      model,
      filterSet,
      config,
      security,
      queryState: createQueryState(input.initial || {}),
      view: input.view ?? options.view,
      timeZone,
      aliases: createAliasGenerator(),
      deferred,
    };

    for (const backend of backends) {
      const result = backend.apply(context);
      if (result && result !== context.queryState) context.queryState = result;
    }
    return context;
  }

  return Object.freeze({
    /**
     * Build Sequelize find options: `{ where?, order?, include?, attributes? }`.
     * @param {{ query?: object, request?: object, model?: object, view?: object, initial?: object }} [input]
     */
    apply(input = {}) {
      return toSequelizeOptions(run(input, null).queryState);
    },

    /**
     * Like `apply`, plus the validations that need the database: a
     * ModelChoice / ModelMultipleChoice value that does not exist (or is
     * outside `queryset`) is rejected with a 400, as in django-filter.
     * @param {{ query?: object, request?: object, model?: object, view?: object, initial?: object }} [input]
     */
    async applyAsync(input = {}) {
      const deferred = [];
      const context = run(input, deferred);
      await Promise.all(deferred.map((check) => check()));
      return toSequelizeOptions(context.queryState);
    },

    filterSet,
    config,
    security,
    backends,
  });
}

export { defineFilterSet, expandFilterFields, createQueryState, cloneQueryState, toSequelizeOptions };
