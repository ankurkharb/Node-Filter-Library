# API Reference

Everything is exported from the package root: `import { ... } from 'node-query-filter'`.

## Core

### `defineFilterSet(fields)` → `FilterSet`

Declare filters. See [README › Declaring filters](../README.md#declaring-filters) for the definition options and
[CONFIGURATION.md](CONFIGURATION.md#definefiltersetfields) for the accepted forms. Returns a frozen object
`{ fields: Map<string, Definition>, get(key), keys() }`. Throws `ConfigurationError` for invalid definitions.

### `expandFilterFields(filterFields)` → `object`

Expands the `filterFields` shorthand into definitions (types `'auto'`). Used by `createFiltering`.

### `createFiltering(options)` → `Filtering`

Options: [CONFIGURATION.md](CONFIGURATION.md). Returns a frozen object:

| Member                                        |                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `apply(input)`                                | Synchronous. Returns Sequelize options `{ where?, order?, include?, attributes? }`. |
| `applyAsync(input)`                           | Same, plus database-backed validation (model-choice values). Returns a promise.     |
| `filterSet`, `config`, `security`, `backends` | The resolved configuration.                                                         |

### `DEFAULT_SECURITY`, `DEFAULT_RESERVED_PARAMS`

Frozen defaults used by `createFiltering`: `DEFAULT_SECURITY` is
`{ maxInValues: 100, maxFilters: 50, maxRelationshipDepth: 3, maxSearchTerms: 20, regexMaxLength: 200 }`;
`DEFAULT_RESERVED_PARAMS` is `['page', 'page_size', 'limit', 'offset', 'cursor']`.

### `resolveFilterParam(param, filterSet, model?)` → `{ key, lookup, filter } | null`

Which filter and lookup a query param maps to, or `null` if it is not a filter param (it would be ignored).

## Backends

| Export                | DRF equivalent                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BaseFilterBackend`   | `BaseFilterBackend`. Subclass and implement `apply(context)`, returning `context.queryState`.                                                     |
| `DjangoFilterBackend` | `django_filters.rest_framework.DjangoFilterBackend`                                                                                               |
| `SearchFilter`        | `rest_framework.filters.SearchFilter`. `new SearchFilter({ searchParam })`; override `getSearchFields(context)` / `getSearchTerms(context)`.      |
| `OrderingFilter`      | `rest_framework.filters.OrderingFilter`. `new OrderingFilter({ orderingParam })`; override `getValidFields`, `getDefaultOrdering`, `getOrdering`. |

A backend may also be a plain function `(context) => queryState | void`.

### The context

| Property                          |                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `query`                           | The raw query input. Use `normalizeQuery(context.query)` to read it.                  |
| `request`, `view`                 | As passed to `apply()` / `createFiltering()`.                                         |
| `model`                           | The Sequelize model.                                                                  |
| `filterSet`, `config`, `security` | Resolved configuration.                                                               |
| `queryState`                      | `{ where, include, order, attributes }` built so far. Add conditions with `andWhere`. |
| `timeZone`                        | `{ name, offsetMinutes }` in effect.                                                  |

## Query-state helpers

| Export                                                                             |                                                                                                                         |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `andWhere(state, condition)`                                                       | AND a condition into `state.where`, keeping everything already there.                                                   |
| `mergeIncludePath(state, aliases, where, model, { required })`                     | Add or merge an include path — for backends that want to _load_ associations. The built-in backends never use includes. |
| `hasWhereConditions(where)`                                                        | Whether a where object has any string or `Op` keys.                                                                     |
| `createQueryState(initial)`, `cloneQueryState(state)`, `toSequelizeOptions(state)` | Low-level state handling.                                                                                               |

## Lookups

| Export                                                                                                   |                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALL_LOOKUPS`                                                                                            | `Set` of every bare lookup name.                                                                                                                          |
| `TRANSFORMS`                                                                                             | Transform name → value type (`'integer'`, `'date'`, `'time'`).                                                                                            |
| `DEFAULT_LOOKUP`                                                                                         | `'exact'`                                                                                                                                                 |
| `SEARCH_PREFIXES`                                                                                        | `{ '^': 'istartswith', '=': 'iexact', $: 'iregex', '@': 'search' }`                                                                                       |
| `parseLookup(name)`                                                                                      | `'year__gte'` → `{ name, transform: 'year', op: 'gte' }`, or `null`.                                                                                      |
| `isKnownLookup(name)`                                                                                    |                                                                                                                                                           |
| `buildLookupCondition(column, lookup, value, { model, columnType, castText, timeZone, regexMaxLength })` | A root-level where fragment from an already-coerced value — for custom filters and backends. Pass `model` so expressions use the application's Sequelize. |
| `escapeLike(value)`                                                                                      | Escape `%`, `_`, `\`.                                                                                                                                     |
| `assertSafeRegex(pattern, maxLength?, meta?)`                                                            | Throws `InvalidValueError` for patterns that are invalid or unsafe for PostgreSQL.                                                                        |

## Coercion

Each follows the Django form field django-filter uses; each returns `null` for an empty value and throws
`InvalidValueError` for an invalid one (except `coerceBoolean`, which returns `null` unless `strict`).

| Export                                          | Returns                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `coerceString(raw, meta?, { strip })`           | string (stripped by default)                                                               |
| `coerceInteger(raw)`                            | number, or a digit string beyond `Number.MAX_SAFE_INTEGER`; decimals truncated toward zero |
| `coerceDecimal(raw)`                            | normalized decimal string                                                                  |
| `coerceFloat(raw)`                              | finite number                                                                              |
| `coerceBoolean(raw, meta?, { strict })`         | `true` / `false` / `null`                                                                  |
| `coerceUuid(raw)`                               | canonical lowercase UUID                                                                   |
| `coerceDate(raw)`                               | `'YYYY-MM-DD'`                                                                             |
| `coerceDateTime(raw, meta?, { timeZone })`      | `Date`                                                                                     |
| `coerceTime(raw)`                               | `'HH:MM:SS[.ffffff]'`                                                                      |
| `coerceChoice(raw, choices)`                    | the choice (not stripped)                                                                  |
| `coerceValue(type, raw, def?, meta?, options?)` | dispatch by filter value type                                                              |
| `splitCsv(raw)`                                 | CSV tokens, `[]` for an empty value                                                        |
| `resolveTimeZone(tz)`                           | `{ name, offsetMinutes }`; throws `ConfigurationError` if invalid                          |

## Parsing

| Export                          |                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizeQuery(input)`         | Object, `URLSearchParams` or string → `{ name: string \| string[] }`; nested objects dropped.                                                                    |
| `lastValue(v)` / `allValues(v)` | `QueryDict.get()` / `getlist()`.                                                                                                                                 |
| `splitSearchTerms(value)`       | How SearchFilter splits `?search=`: commas only; each term trimmed, inner whitespace kept, empty terms dropped; `"…"`/`'…'` unquoted, commas inside quotes kept. |
| `searchSmartSplit(value)`       | DRF's `search_smart_split` (whitespace, commas, quotes). Not used by SearchFilter; available for a `getSearchTerms` override.                                    |
| `parseOrdering(raw)`            | `'-a,b'` → `[{ term, field, direction }]`.                                                                                                                       |

## Errors

`FilteringError` and subclasses are client errors: `status` is `400`, and `toJSON()` returns
`{ name, code, message, field, lookup, value, details }`.

| Class                                           | `code`                                                                 | Thrown when                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `FilteringError`                                | `filtering_error`                                                      | base class                                                                        |
| `FilterValidationError`                         | `filter_validation_error`, `invalid_filters`                           | base of the validation errors; `invalid_filters` wraps several (`details.errors`) |
| `InvalidValueError`                             | `invalid_value`, `invalid_regex`, `unsafe_regex`, `ambiguous_timezone` | a value cannot be parsed or is not allowed                                        |
| `UnknownFilterError`                            | `unknown_filter`                                                       | unknown param, with `unknownFilterBehavior: 'error'`                              |
| `InvalidLookupError`                            | `invalid_lookup`                                                       | `field__<lookup>` for a lookup not enabled, with `'error'`                        |
| `UnsupportedLookupError`                        | `unsupported_lookup`                                                   | `field__<suffix>` where the suffix is not a lookup, with `'error'`                |
| `InvalidOrderingError`                          | `invalid_ordering`                                                     | disallowed ordering term, with `invalidOrderingBehavior: 'error'`                 |
| `InvalidSearchError`                            | `invalid_search`                                                       | `?search=` contains a null character                                              |
| `SecurityLimitError`                            | `security_limit`                                                       | `maxInValues`, `maxFilters` or `maxSearchTerms` exceeded                          |
| `UnknownFieldError`, `InvalidRelationshipError` | `unknown_field`, `invalid_relationship`                                | not thrown by the built-in backends; for custom ones                              |

`ConfigurationError` (`code: 'configuration_error'`) reports a mistake in _your_ configuration. That includes a
filter `method` that returns a value or a promise, and a `queryset` that is async or does not return a
where object: both callbacks must be synchronous (see [README › Custom filters](../README.md#custom-filters-and-backends)). It extends
`Error`, not `FilteringError`, so a handler that maps `FilteringError` to 400 lets it through as a 500.
