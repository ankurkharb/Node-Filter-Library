# Configuration Reference

## `createFiltering(options)`

Equivalent of a DRF view's filtering attributes. Unknown option names throw `ConfigurationError`.

| Option                    | DRF equivalent              | Default                                               | Notes                                                                                                                     |
| ------------------------- | --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `model`                   | `queryset.model`            | —                                                     | Sequelize model. Given here, the whole configuration is validated immediately. Can also be passed per call to `apply()`.  |
| `filterSet`               | `filterset_class`           | `null`                                                | From `defineFilterSet()`.                                                                                                 |
| `filterFields`            | `filterset_fields`          | —                                                     | Shorthand; types inferred from the model. Not together with `filterSet`.                                                  |
| `searchFields`            | `search_fields`             | `[]`                                                  | See [README › Search](../README.md#search).                                                                               |
| `getSearchFields`         | `get_search_fields()`       | —                                                     | `(context) => string[]`, evaluated per request.                                                                           |
| `orderingFields`          | `ordering_fields`           | `[]`                                                  | Array or `'__all__'`. `[]` means clients cannot order.                                                                    |
| `defaultOrdering`         | `ordering`                  | `[]`                                                  | `'-created_at'` or `['-created_at', 'id']`. Not checked against `orderingFields`.                                         |
| `ordering`                | `ordering`                  | —                                                     | Alias of `defaultOrdering`. Not both.                                                                                     |
| `backends`                | `filter_backends`           | `[DjangoFilterBackend, SearchFilter, OrderingFilter]` | Classes, instances or functions `(context) => queryState`.                                                                |
| `searchParam`             | `SEARCH_PARAM`              | `'search'`                                            |                                                                                                                           |
| `orderingParam`           | `ORDERING_PARAM`            | `'ordering'`                                          |                                                                                                                           |
| `timeZone`                | `TIME_ZONE` (with `USE_TZ`) | Sequelize `timezone` option, else `'+00:00'`          | IANA name or `±HH:MM`. See [README › Time zones](../README.md#time-zones).                                                |
| `searchConfig`            | —                           | `null`                                                | PostgreSQL text-search configuration for `@` fields (e.g. `'english'`). `null` uses the database default, as Django does. |
| `unknownFilterBehavior`   | —                           | `'ignore'`                                            | `'error'` rejects params that are not filters. django-filter always ignores.                                              |
| `reservedParams`          | —                           | `['page', 'page_size', 'limit', 'offset', 'cursor']`  | Never treated as unknown filters (only matters with `'error'`). A declared filter of the same name still works.           |
| `invalidOrderingBehavior` | —                           | `'ignore'`                                            | `'error'` rejects ordering terms that are not allowed. DRF always ignores.                                                |
| `strictBooleans`          | —                           | `false`                                               | `true` makes an unrecognized boolean (`?is_active=maybe`) a 400 instead of ignoring the filter.                           |
| `security`                | —                           | see below                                             |                                                                                                                           |
| `view`                    | the view                    | —                                                     | Passed to backends and filter methods as `context.view`.                                                                  |

### `security`

All values are non-negative integers; unknown keys throw `ConfigurationError`.

| Key                    | Default | Limits                                                                                         |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `maxInValues`          | `100`   | values in one `__in` param (`SecurityLimitError`)                                              |
| `maxFilters`           | `50`    | filters applied in one request (`SecurityLimitError`)                                          |
| `maxSearchTerms`       | `20`    | terms in `?search=` (`SecurityLimitError`)                                                     |
| `maxRelationshipDepth` | `3`     | `__` hops in any configured filter, search or ordering field (`ConfigurationError` at startup) |
| `regexMaxLength`       | `200`   | length of a client-supplied regex (`InvalidValueError`)                                        |

## `defineFilterSet(fields)`

```js
defineFilterSet({ age: { lookups: ['exact', 'gte'] }, username: true, status: ['exact', 'in'] });
defineFilterSet({ filterFields: ['status'], fields: { min_age: { field: 'age', lookup: 'gte' } } });
```

A field definition is an object (options in the [README](../README.md#declaring-filters)), `true` (exact only) or
an array of lookups.

## `apply(input)` / `applyAsync(input)`

| Input     | Meaning                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `query`   | Query params: an object (`req.query`), `URLSearchParams` or a query string. Defaults to `request.query`. |
| `request` | The request, available to backends and methods as `context.request`.                                     |
| `model`   | Overrides the model given to `createFiltering`.                                                          |
| `view`    | Overrides `options.view`.                                                                                |
| `initial` | `{ where, include, order, attributes }` to start from.                                                   |

Both return `{ where?, order?, include?, attributes? }` for `findAll` / `findAndCountAll` / `count`.
`applyAsync` additionally validates model-choice values against the database.

## Time-zone assumptions

- `datetime` values with an offset (`Z`, `+05:30`) are exact instants.
- Naive `datetime` values, `dateFromToRange` day boundaries and every transform use `timeZone`.
- `date` values are calendar dates and are never shifted.
- A naive datetime that does not exist (DST gap) or is ambiguous (DST overlap) in `timeZone` is a 400.
- JavaScript dates have millisecond precision; microseconds in input are truncated.
