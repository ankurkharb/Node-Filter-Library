/**
 * Type definitions for node-query-filter.
 *
 * Hand-written to match src/. `test/types/` type-checks these against real
 * usage; keep both in sync when the public API changes.
 */

import type { FindAttributeOptions, Includeable, Model, ModelStatic, Order, WhereOptions } from 'sequelize';

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

/** Any Sequelize model class. */
export type AnyModel = ModelStatic<Model<any, any>>;

/** A where condition, as accepted by `Model.findAll({ where })`. */
export type Where = WhereOptions<any>;

/** What `apply()` accepts as the query: `req.query`, `URLSearchParams`, or a raw string (`'?age__gte=18'`). */
export type QueryInput = Record<string, unknown> | URLSearchParams | string | null | undefined;

/** A query after `normalizeQuery()`: repeated params become arrays. */
export type NormalizedQuery = Record<string, string | string[]>;

export type ComparisonLookup =
  | 'exact'
  | 'iexact'
  | 'contains'
  | 'icontains'
  | 'startswith'
  | 'istartswith'
  | 'endswith'
  | 'iendswith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'range'
  | 'isnull'
  | 'regex'
  | 'iregex'
  | 'search';

export type TransformName =
  | 'date'
  | 'time'
  | 'year'
  | 'iso_year'
  | 'month'
  | 'day'
  | 'week'
  | 'week_day'
  | 'iso_week_day'
  | 'quarter'
  | 'hour'
  | 'minute'
  | 'second';

/** Comparisons allowed after a transform (`created_at__year__gte`). */
export type TransformComparison = 'exact' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'range';

/** Every valid lookup name: `gte`, `year`, `year__gte`, ... */
export type LookupName = ComparisonLookup | TransformName | `${TransformName}__${TransformComparison}`;

export type FilterType =
  | 'auto'
  | 'string'
  | 'char'
  | 'integer'
  | 'number'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'uuid'
  | 'date'
  | 'datetime'
  | 'time'
  | 'choice'
  | 'multipleChoice'
  | 'modelChoice'
  | 'modelMultipleChoice'
  | 'range'
  | 'dateFromToRange'
  | 'datetimeFromToRange'
  | 'custom';

/** Choice values, or Django-style `[value, label]` pairs. */
export type Choices = ReadonlyArray<string | number | boolean | readonly [string | number | boolean, string]>;

export interface TimeZone {
  name: string;
  /** Set for fixed offsets, `null` for IANA zones. */
  offsetMinutes: number | null;
}

// ---------------------------------------------------------------------------
// Query state and context
// ---------------------------------------------------------------------------

/** Mutable state shared by the backends. Add conditions with `andWhere`. */
export interface QueryState {
  where: Where;
  include: Includeable[];
  order: any[];
  attributes: FindAttributeOptions | undefined;
}

export interface InitialQueryState {
  where?: Where;
  include?: Includeable[];
  order?: any[];
  attributes?: FindAttributeOptions;
}

/** What `apply()` returns: spread it into `Model.findAll()`. Only non-empty keys are present. */
export interface FilterOptions {
  where?: Where;
  order?: Order;
  include?: Includeable[];
  attributes?: FindAttributeOptions;
}

export interface SecurityOptions {
  /** Values in one `__in` param. Default 100. */
  maxInValues: number;
  /** Filters applied in one request. Default 50. */
  maxFilters: number;
  /** `__` hops in any configured field. Default 3. */
  maxRelationshipDepth: number;
  /** Terms in `?search=`. Default 20. */
  maxSearchTerms: number;
  /** Length of a client regex. Default 200. */
  regexMaxLength: number;
}

export interface OrderingTerm {
  term: string;
  field: string;
  direction: 'ASC' | 'DESC';
}

/** The resolved configuration of a `createFiltering()` instance. */
export interface FilteringConfig {
  readonly searchFields: readonly string[];
  readonly getSearchFields: ((context: FilterContext) => readonly string[]) | undefined;
  readonly orderingFields: readonly string[] | '__all__';
  readonly defaultOrdering: readonly OrderingTerm[];
  readonly searchParam: string;
  readonly orderingParam: string;
  readonly unknownFilterBehavior: 'ignore' | 'error';
  readonly invalidOrderingBehavior: 'ignore' | 'error';
  readonly reservedParams: readonly string[];
  readonly timeZone: TimeZone | null;
  readonly searchConfig: string | null;
  readonly strictBooleans: boolean;
}

/** Passed to every backend, filter `method` and `queryset`. */
export interface FilterContext {
  query: QueryInput;
  request: any;
  view: any;
  model: AnyModel | undefined;
  filterSet: FilterSet | null;
  config: FilteringConfig;
  security: Readonly<SecurityOptions>;
  queryState: QueryState;
  timeZone: TimeZone;
  /** Subquery alias generator (internal). */
  aliases: { next(): string };
  /** Async validations collected by `applyAsync()` (internal); `null` under `apply()`. */
  deferred: Array<() => Promise<void>> | null;
}

// ---------------------------------------------------------------------------
// Filter sets
// ---------------------------------------------------------------------------

export interface FilterMethodArgs {
  /**
   * The parsed value: the raw string for `custom`, the parsed value for typed
   * filters, `{ start, stop }` for range filters, and a string array for
   * multiple-choice filters.
   */
  value: any;
  name: string;
  field: string;
  /** The lookup of the param that matched (`'exact'`, `'gte'`, ...; `'in'` for multiple-choice filters). */
  lookup: string;
  queryState: QueryState;
  context: FilterContext;
  model: AnyModel | undefined;
  /** AND a condition onto the query. The only way a method should add conditions. */
  andWhere(condition: Where | null | undefined): QueryState;
}

/**
 * A custom filter method. Must be synchronous, add conditions with `andWhere`,
 * and return nothing (or the query state).
 */
export type FilterMethod = (args: FilterMethodArgs) => void | QueryState;

export interface FilterDefinitionOptions {
  /** Default `'auto'`: inferred from the model attribute. */
  type?: FilterType;
  /** Model attribute or column, when it differs from the key. */
  field?: string;
  /** Alias of `field`. */
  attribute?: string;
  /** Association aliases to follow: `['company']` or `'company__departments'`. */
  path?: readonly string[] | string;
  /** Alias of `path`. */
  associationPath?: readonly string[] | string;
  /** For `choice` / `multipleChoice`. */
  choices?: Choices;
  method?: FilterMethod;
  /** Alias of `method`. */
  filter?: FilterMethod;
  /** Negate the filter; NULL rows are kept (django-filter `exclude=True`). */
  exclude?: boolean;
  /** Trim string values. Default `true`. */
  strip?: boolean;
  /** String filters: `?name=` matches the empty string instead of being skipped. */
  allowEmpty?: boolean;
  /** `multipleChoice`: all values must match (AND). */
  conjoined?: boolean;
  /** `choice` / `multipleChoice`: a value meaning `IS NULL`. */
  nullValue?: string;
  /** Model-choice filters: restrict allowed related rows. Synchronous; must return a where object. */
  queryset?: (context: FilterContext) => Where;
  /** `range` only. */
  valueType?: 'integer' | 'float' | 'decimal';
}

/**
 * A filter definition. `lookups` (one param per lookup: `age`, `age__gte`, ...)
 * and `lookup` (one param named after the key) cannot be combined.
 */
export type FilterDefinition = FilterDefinitionOptions &
  (
    | {
        /** Generated filters: one param per lookup (`age`, `age__gte`, ...). Not with `lookup`. */
        lookups?: ReadonlyArray<LookupName | '__all__'>;
        lookup?: never;
      }
    | {
        /** Declared filter: one param named after the key. Not with `lookups`. */
        lookup?: LookupName;
        lookups?: never;
      }
  );

/** `true` = `{ lookups: ['exact'] }`; an array = `{ lookups: [...] }`. */
export type FilterSpec = FilterDefinition | true | ReadonlyArray<LookupName | '__all__'>;

/** DRF `filterset_fields`: a list of names (exact only), or name → lookups. */
export type FilterFields = readonly string[] | Record<string, FilterSpec>;

/** A normalized filter definition, as stored in a FilterSet. */
export interface NormalizedFilter {
  readonly key: string;
  readonly type: FilterType;
  readonly lookups: readonly string[];
  /** `true` for a declared filter (`lookup` or neither), `false` for generated (`lookups`). */
  readonly declared: boolean;
  readonly attribute: string;
  readonly path: readonly string[] | null;
  readonly choices: Choices | null;
  readonly method: FilterMethod | null;
  readonly exclude: boolean;
  readonly strip: boolean;
  readonly allowEmpty: boolean;
  readonly conjoined: boolean;
  readonly nullValue: string | null;
  readonly queryset: ((context: FilterContext) => Where) | null;
  readonly valueType: 'integer' | 'float' | 'decimal' | null;
}

declare const filterSetBrand: unique symbol;

/** Created by `defineFilterSet()`. */
export interface FilterSet {
  readonly [filterSetBrand]: true;
  readonly fields: Map<string, NormalizedFilter>;
  get(key: string): NormalizedFilter | undefined;
  keys(): string[];
}

/** Either filter key → definition, or `{ filterFields, fields }`. */
export type FilterSetConfig =
  Record<string, FilterSpec> | { filterFields?: FilterFields; fields?: Record<string, FilterSpec> };

export function defineFilterSet(config?: FilterSetConfig): FilterSet;

export function expandFilterFields(filterFields: FilterFields): Record<string, FilterSpec>;

export function resolveFilterParam(
  paramName: string,
  filterSet: FilterSet,
  model?: AnyModel,
): { key: string; lookup: string | null; filter: any } | null;

// ---------------------------------------------------------------------------
// createFiltering
// ---------------------------------------------------------------------------

/** A class with `apply(context)`, an instance of one, or a plain function. */
export type Backend =
  | (new () => { apply(context: FilterContext): QueryState | void })
  | { apply(context: FilterContext): QueryState | void }
  | ((context: FilterContext) => QueryState | void);

export interface CreateFilteringBaseOptions {
  /** The Sequelize model. Enables relationships, type inference and startup validation. */
  model?: AnyModel;
  searchFields?: readonly string[];
  /** Choose search fields per request. Synchronous. */
  getSearchFields?: (context: FilterContext) => readonly string[];
  /** Fields clients may order by, or `'__all__'`. Default `[]` (clients cannot order). */
  orderingFields?: readonly string[] | '__all__';
  backends?: readonly Backend[];
  security?: Partial<SecurityOptions>;
  /** Default `'search'`. */
  searchParam?: string;
  /** Default `'ordering'`. */
  orderingParam?: string;
  unknownFilterBehavior?: 'ignore' | 'error';
  invalidOrderingBehavior?: 'ignore' | 'error';
  reservedParams?: readonly string[];
  /** IANA name (`'Asia/Kolkata'`) or offset (`'+05:30'`). */
  timeZone?: string;
  /** PostgreSQL text-search config for `@` search fields. */
  searchConfig?: string | null;
  strictBooleans?: boolean;
  /** Available to backends and methods as `context.view`. */
  view?: any;
}

/** `createFiltering()` options. `filterSet` / `filterFields` and `defaultOrdering` / `ordering` are either-or pairs. */
export type CreateFilteringOptions = CreateFilteringBaseOptions &
  (
    | { filterSet?: FilterSet | null; filterFields?: never }
    | {
        /** Shorthand instead of `filterSet`. Not both. */
        filterFields?: FilterFields;
        filterSet?: never;
      }
  ) &
  (
    | {
        /** `'-created_at'` or `['-created_at', 'id']`. Used when `?ordering=` is absent or all invalid. */
        defaultOrdering?: string | readonly string[];
        ordering?: never;
      }
    | {
        /** Alias of `defaultOrdering`. */
        ordering?: string | readonly string[];
        defaultOrdering?: never;
      }
  );

export interface ApplyInput {
  query?: QueryInput;
  /** Your request object; `query` defaults to `request.query`. */
  request?: any;
  model?: AnyModel;
  view?: any;
  /** A starting point; the library ANDs its conditions onto `initial.where`. */
  initial?: InitialQueryState;
}

export interface Filtering {
  apply(input?: ApplyInput): FilterOptions;
  /** Like `apply`, plus database checks that model-choice values exist. */
  applyAsync(input?: ApplyInput): Promise<FilterOptions>;
  readonly filterSet: FilterSet | null;
  readonly config: FilteringConfig;
  readonly security: Readonly<SecurityOptions>;
  readonly backends: ReadonlyArray<{ apply(context: FilterContext): QueryState | void }>;
}

export function createFiltering(options?: CreateFilteringOptions): Filtering;

export const DEFAULT_SECURITY: Readonly<SecurityOptions>;
export const DEFAULT_RESERVED_PARAMS: readonly string[];

// ---------------------------------------------------------------------------
// Query state helpers
// ---------------------------------------------------------------------------

export function createQueryState(initial?: InitialQueryState): QueryState;
export function cloneQueryState(state: QueryState): QueryState;
export function toSequelizeOptions(state: QueryState): FilterOptions;
/** AND a condition into the root where clause, keeping everything already there. */
export function andWhere(state: QueryState, condition: Where | null | undefined): QueryState;
export function hasWhereConditions(where: unknown): boolean;
export function mergeIncludePath(
  state: QueryState,
  associationPath: readonly string[],
  leafWhere: Where | null,
  model: AnyModel,
  options?: { required?: boolean },
): QueryState;

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

export class BaseFilterBackend {
  apply(context: FilterContext): QueryState | void;
}

export class DjangoFilterBackend extends BaseFilterBackend {
  apply(context: FilterContext): QueryState;
}

export class SearchFilter extends BaseFilterBackend {
  constructor(options?: { searchParam?: string });
  searchParam: string | undefined;
  /** DRF `get_search_fields`. */
  getSearchFields(context: FilterContext): readonly string[];
  /** DRF `get_search_terms`. */
  getSearchTerms(context: FilterContext): string[];
  apply(context: FilterContext): QueryState;
}

export class OrderingFilter extends BaseFilterBackend {
  constructor(options?: { orderingParam?: string });
  orderingParam: string | undefined;
  /** DRF `get_valid_fields`: the fields clients may order by, name → compiled field. */
  getValidFields(context: FilterContext): Map<string, any>;
  /** DRF `get_default_ordering`. */
  getDefaultOrdering(context: FilterContext): Array<{ compiled: any; direction: 'ASC' | 'DESC' }>;
  /** DRF `get_ordering`. */
  getOrdering(context: FilterContext): Array<{ compiled: any; direction: 'ASC' | 'DESC' }>;
  apply(context: FilterContext): QueryState;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface FilteringErrorMeta {
  code?: string;
  field?: string;
  lookup?: string;
  value?: unknown;
  details?: object;
}

export interface FilteringErrorJSON {
  name: string;
  code: string;
  message: string;
  field: string | undefined;
  lookup: string | undefined;
  value: unknown;
  details: object | undefined;
}

/** A client error: map to HTTP `status` (400). */
export class FilteringError extends Error {
  constructor(message: string, meta?: FilteringErrorMeta);
  code: string;
  status: 400;
  field: string | undefined;
  lookup: string | undefined;
  value: unknown;
  details: any;
  toJSON(): FilteringErrorJSON;
}

export class FilterValidationError extends FilteringError {}
export class UnknownFilterError extends FilterValidationError {}
export class UnknownFieldError extends FilterValidationError {}
export class InvalidLookupError extends FilterValidationError {}
export class UnsupportedLookupError extends FilterValidationError {}
export class InvalidValueError extends FilterValidationError {}
export class InvalidOrderingError extends FilterValidationError {}
export class InvalidSearchError extends FilterValidationError {}
export class InvalidRelationshipError extends FilterValidationError {}
export class SecurityLimitError extends FilteringError {}

/** The developer's configuration is wrong. Map to HTTP 500, never 400. */
export class ConfigurationError extends Error {
  constructor(message: string, details?: object);
  code: 'configuration_error';
  details: any;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface ParsedLookup {
  name: string;
  transform: TransformName | null;
  op: ComparisonLookup;
}

export const ALL_LOOKUPS: ReadonlySet<string>;
export const DEFAULT_LOOKUP: 'exact';
export const SEARCH_PREFIXES: Readonly<{ '^': 'istartswith'; '=': 'iexact'; $: 'iregex'; '@': 'search' }>;
/** Transform → the type of value it produces. */
export const TRANSFORMS: Readonly<Record<TransformName, 'date' | 'time' | 'integer'>>;

export function parseLookup(name: string): ParsedLookup | null;
export function isKnownLookup(name: string): boolean;
/** Escape `%`, `_` and `\` for a LIKE pattern. */
export function escapeLike(value: string): string;
/** Throws `InvalidValueError` for a regex that is too long, invalid or too complex. */
export function assertSafeRegex(pattern: string, maxLength?: number, meta?: FilteringErrorMeta): void;
/** A root-level condition on an attribute, for custom backends. `value` must already be coerced. */
export function buildLookupCondition(
  column: string,
  lookup: LookupName | string,
  value: unknown,
  options?: {
    model?: AnyModel;
    regexMaxLength?: number;
    timeZone?: TimeZone;
    columnType?: string;
    castText?: boolean;
  },
): Where;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function normalizeQuery(input: QueryInput): NormalizedQuery;
/** The last value of a possibly repeated param (Django `QueryDict.get`). */
export function lastValue(value: string | string[] | undefined): string | undefined;
export function allValues(value: string | string[] | undefined): string[];
/** This library's search syntax: comma-separated terms, quotes group a phrase. */
export function splitSearchTerms(value: string): string[];
/** DRF's search syntax: whitespace/comma-separated terms. */
export function searchSmartSplit(value: string): string[];
export function parseOrdering(raw: string | string[] | undefined): OrderingTerm[];
/** Split an `__in` / `__range` value on commas (no trimming). */
export function splitCsv(raw: unknown): string[];

// ---------------------------------------------------------------------------
// Coercion (throw InvalidValueError on invalid input; null = skip the filter)
// ---------------------------------------------------------------------------

export interface CoerceMeta {
  field?: string;
  lookup?: string;
}

export function coerceValue(
  type:
    | 'string'
    | 'char'
    | 'integer'
    | 'number'
    | 'decimal'
    | 'float'
    | 'boolean'
    | 'uuid'
    | 'date'
    | 'datetime'
    | 'time'
    | 'choice',
  raw: unknown,
  def?: { choices?: Choices; strip?: boolean },
  meta?: CoerceMeta,
  options?: { timeZone?: TimeZone; strictBooleans?: boolean },
): string | number | boolean | Date | null;
export function coerceString(raw: unknown, meta?: CoerceMeta, options?: { strip?: boolean }): string | null;
/** Returns a string for values beyond the safe integer range. */
export function coerceInteger(raw: unknown, meta?: CoerceMeta): number | string | null;
export function coerceDecimal(raw: unknown, meta?: CoerceMeta): string | null;
export function coerceFloat(raw: unknown, meta?: CoerceMeta): number | null;
export function coerceBoolean(raw: unknown, meta?: CoerceMeta, options?: { strict?: boolean }): boolean | null;
export function coerceUuid(raw: unknown, meta?: CoerceMeta): string | null;
/** Returns `YYYY-MM-DD`. */
export function coerceDate(raw: unknown, meta?: CoerceMeta): string | null;
export function coerceDateTime(raw: unknown, meta?: CoerceMeta, options?: { timeZone?: TimeZone }): Date | null;
export function coerceTime(raw: unknown, meta?: CoerceMeta): string | null;
export function coerceChoice(raw: unknown, choices: Choices, meta?: CoerceMeta): string | null;
/** Validate an IANA name or offset; throws `ConfigurationError` if invalid. */
export function resolveTimeZone(tz: string): TimeZone;
