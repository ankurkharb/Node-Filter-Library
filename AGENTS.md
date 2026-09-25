# node-query-filter — complete guide (for developers and AI agents)

This single file is everything needed to use this package correctly. Read it once, top to bottom. The
other files in `docs/` go deeper on single topics, but nothing here depends on them.

---

## 1. What it is

Django REST Framework / django-filter–style **filtering, search and ordering** for:

- **Node.js ≥ 18**, plain JavaScript, usable from **ES modules** (`import`) and **CommonJS** (`require`);
  **TypeScript types included**
- **Sequelize 6** (peer dependency) and **PostgreSQL only** — no other ORM or database is supported

It turns HTTP query params such as `?age__gte=18&search=rahul&ordering=-created_at` into Sequelize
options `{ where, order }` that you spread into `Model.findAll()`. Sequelize generates the SQL.

It is **not** a web framework integration: it takes a query object and returns options. It works with
Express, Fastify, Koa, or plain `http`.

## 2. Install

```bash
npm install node-query-filter          # or: npm install github:ankurkharb/Node-Filter-Library
npm install sequelize pg pg-hstore        # the app provides these
```

In TypeScript or CommonJS the API is identical:
`const { createFiltering, defineFilterSet, FilteringError } = require('node-query-filter');`.
Types such as `FilterContext`, `QueryState`, `FilterDefinition` and `CreateFilteringOptions` are exported.
TypeScript rejects most configuration mistakes before the code runs (unknown options and lookups,
`lookup` with `lookups`, async or value-returning methods). A configuration kept in a variable needs
`satisfies`, or TypeScript widens `'gte'` to `string`:
`const filters = { age: { lookups: ['gte'] } } satisfies FilterSetConfig;` (likewise `CreateFilteringOptions`).
Use one module system per app: the ESM and CommonJS builds each have their own error classes.

## 3. The whole pattern

```js
import { Op } from 'sequelize';
import { createFiltering, defineFilterSet, FilteringError } from 'node-query-filter';

// 1. Once, at startup (module level) — like a DRF view's filter configuration.
const userFiltering = createFiltering({
  model: User, // always pass the model: it enables relationships and validates config at startup
  filterSet: defineFilterSet({
    age: { lookups: ['exact', 'gte', 'lte', 'in', 'range'] },
    status: { type: 'choice', choices: ['active', 'pending', 'inactive'], lookups: ['exact', 'in'] },
    created_at: { lookups: ['gte', 'lt', 'date', 'year'] },
    company__name: { lookups: ['icontains'] }, // follows the association with `as: 'company'`
  }),
  searchFields: ['username', 'email', 'company__name'],
  orderingFields: ['username', 'created_at', 'age'],
  defaultOrdering: ['-created_at', 'id'],
});

// 2. Per request.
app.get('/users', async (req, res, next) => {
  try {
    const options = userFiltering.apply({ query: req.query, request: req });
    const { rows, count } = await User.findAndCountAll({ ...options, limit: 20, offset: 0 });
    res.json({ count, results: rows });
  } catch (err) {
    if (err instanceof FilteringError) return res.status(err.status).json({ error: err.toJSON() });
    next(err); // anything else — including ConfigurationError — is a 500
  }
});
```

Rules that follow from this pattern:

- Create the filtering **once**, not per request. With `model` given, configuration mistakes throw a
  `ConfigurationError` immediately at startup.
- `apply()` returns only `where` / `order` (plus `include` / `attributes` if you passed them in `initial`).
  Add your own `include`, `attributes`, `limit`, `offset` when calling Sequelize.
- `query` may be `req.query` (object), a `URLSearchParams`, or a raw string like `'?age__gte=18'`.
- Map `FilteringError` to HTTP 400 (`err.status` is `400`). Never map `ConfigurationError` to 400: it
  means the developer's configuration is wrong.

## 4. `createFiltering(options)`

| Option                    | Default                                               | Meaning                                                                                                                       |
| ------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `model`                   | —                                                     | The Sequelize model. Needed for relationships, type inference and startup validation. Can also be passed per call to `apply`. |
| `filterSet`               | `null`                                                | From `defineFilterSet()` (section 5).                                                                                         |
| `filterFields`            | —                                                     | Shorthand instead of `filterSet` (section 5.3). Not both.                                                                     |
| `searchFields`            | `[]`                                                  | Fields for `?search=` (section 9).                                                                                            |
| `getSearchFields`         | —                                                     | `(context) => string[]`, chosen per request. Must be synchronous.                                                             |
| `orderingFields`          | `[]`                                                  | Fields clients may order by, or `'__all__'`. With `[]`, clients cannot order at all.                                          |
| `defaultOrdering`         | `[]`                                                  | `'-created_at'` or `['-created_at', 'id']`. Used when `?ordering=` is absent or all invalid. `ordering` is an alias.          |
| `backends`                | `[DjangoFilterBackend, SearchFilter, OrderingFilter]` | Run in order (section 11).                                                                                                    |
| `searchParam`             | `'search'`                                            | Query param name for search.                                                                                                  |
| `orderingParam`           | `'ordering'`                                          | Query param name for ordering.                                                                                                |
| `timeZone`                | Sequelize's `timezone` option, else `'+00:00'`        | IANA name (`'Asia/Kolkata'`) or offset (`'+05:30'`). Used by date/time transforms and naive datetimes (section 13).           |
| `searchConfig`            | `null`                                                | PostgreSQL text-search config for `@` search fields (`'english'`). `null` = database default.                                 |
| `unknownFilterBehavior`   | `'ignore'`                                            | `'error'` rejects query params that are not filters.                                                                          |
| `reservedParams`          | `['page', 'page_size', 'limit', 'offset', 'cursor']`  | Never reported as unknown with `'error'`. A declared filter with one of these names still works.                              |
| `invalidOrderingBehavior` | `'ignore'`                                            | `'error'` rejects disallowed ordering terms instead of dropping them.                                                         |
| `strictBooleans`          | `false`                                               | `true`: an unrecognized boolean (`?active=maybe`) is a 400 instead of being ignored.                                          |
| `security`                | see section 15                                        | Resource limits.                                                                                                              |
| `view`                    | —                                                     | Anything you want available to backends and filter methods as `context.view`.                                                 |

Unknown option names throw `ConfigurationError` (a typo like `serachFields` is caught).

Returned object: `{ apply(input), applyAsync(input), filterSet, config, security, backends }`.

`apply(input)` / `applyAsync(input)` — `input` fields: `query`, `request` (defaults `query` to
`request.query`), `model`, `view`, `initial: { where, include, order, attributes }` (a starting point;
the library ANDs its conditions onto `initial.where`).

`applyAsync()` does everything `apply()` does, plus database checks that model-choice values exist
(section 6.4). Use `apply()` unless you need that.

## 5. Declaring filters: `defineFilterSet`

### 5.1 Two kinds of filter, and how their query params are named (same as django-filter)

**Generated filters — `lookups: [...]`** (django-filter `Meta.fields = {'age': ['exact', 'gte']}`).
One query param per lookup. `exact` uses the bare name; every other lookup is `name__lookup`.

```js
defineFilterSet({ age: { lookups: ['exact', 'gte', 'lte'] } });
// params: ?age=  ?age__gte=  ?age__lte=
// NOT accepted: ?age__exact=  (django-filter never generates it; it is ignored like any unknown param)
```

If `exact` is not in `lookups`, then `?age=` is not a param and is ignored.

**Declared filters — `lookup: '...'` or neither** (django-filter `min_age = NumberFilter(field_name='age',
lookup_expr='gte')`). Exactly one param, named after the key.

```js
defineFilterSet({ min_age: { field: 'age', lookup: 'gte' } });
// param: ?min_age=   (and NOT ?min_age__gte=)
defineFilterSet({ status: { type: 'choice', choices: ['a', 'b'] } }); // no lookup given = exact → ?status=
```

`lookup` and `lookups` together is a `ConfigurationError`.

Shorthand forms: `name: true` means `{ lookups: ['exact'] }`; `name: ['gte', 'lte']` means `{ lookups: [...] }`.
`defineFilterSet({ filterFields: [...], fields: {...} })` combines the shorthand with full definitions.

### 5.2 Filter definition options

| Option                     | Meaning                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                     | Section 6. Default `'auto'`: inferred from the model attribute (needs `model`; without it, `'auto'` means `'string'`).                   |
| `lookups` / `lookup`       | Section 5.1. Lookup names in section 7. `lookups: ['__all__']` enables every lookup valid for the column (avoid: includes `regex`).      |
| `field` (`attribute`)      | The model attribute (or its database column name) when it differs from the key. Default: the key's last `__` segment.                    |
| `path` (`associationPath`) | Association aliases to follow, e.g. `['company']`. Default: taken from a `rel__field` key.                                               |
| `choices`                  | For `choice` / `multipleChoice`: `['a', 'b']` or Django-style `[['a', 'Label A'], …]`. For a Sequelize `ENUM`, `'auto'` uses its values. |
| `method`                   | Custom filter function (section 10). `filter` is an alias.                                                                               |
| `exclude`                  | `true` negates the filter and keeps NULL rows (django-filter `exclude=True`).                                                            |
| `strip`                    | String values are trimmed by default (Django `CharField`). `false` keeps whitespace.                                                     |
| `allowEmpty`               | String filters only: `?name=` matches the empty string instead of being skipped.                                                         |
| `conjoined`                | `multipleChoice` only: all values must match (AND) instead of any (OR).                                                                  |
| `nullValue`                | `choice` / `multipleChoice`: a value (e.g. `'null'`) that means `IS NULL`.                                                               |
| `queryset`                 | Model-choice filters: `(context) => where` limiting which related rows are allowed. **Synchronous; must return a where object.**         |
| `valueType`                | `range` only: `'integer'`, `'float'` or `'decimal'`.                                                                                     |

Unknown option names throw `ConfigurationError`.

### 5.3 `filterFields` shorthand (DRF `filterset_fields`)

```js
createFiltering({ model: Product, filterFields: ['category', 'in_stock'] }); // exact only
createFiltering({ model: Product, filterFields: { price: ['gte', 'lte'], in_stock: ['exact'] } });
```

Types come from the model, so `?price__gte=abc` is a 400. An association name (e.g. `category` for
`Product.belongsTo(Category, { as: 'category' })`) becomes a model-choice filter: `?category=3`.

### 5.4 Names: attributes, columns, camelCase

A filter key, search field or ordering field may name either the Sequelize **attribute** (`createdAt`) or
its **column** (`created_at`); both resolve. For anything else, set `field`. Relationship segments use the
association alias (`as`), not the model name.

## 6. Filter types

| `type`                   | Query params                           | Accepts                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'auto'` (default)       | per lookups                            | Inferred from the Sequelize type: INTEGER/BIGINT→integer, FLOAT/DOUBLE/REAL→float, DECIMAL→decimal, BOOLEAN→boolean, UUID→uuid, DATEONLY→date, DATE→datetime, TIME→time, ENUM→choice, text types→string. An association name → modelChoice. |
| `'string'` (`'char'`)    | per lookups                            | Any text; trimmed; whitespace-only = no filter.                                                                                                                                                                                             |
| `'integer'`              | per lookups                            | Decimal syntax (`18`, `+18`, `18.0`, `1e1`), **truncated toward zero** (`18.7` → 18), as Django does. Huge values stay exact (as strings).                                                                                                  |
| `'number'` / `'decimal'` | per lookups                            | Decimal syntax, kept as a string (no precision loss). `number` on an integer column truncates.                                                                                                                                              |
| `'float'`                | per lookups                            | Finite numbers; `nan` / `inf` rejected.                                                                                                                                                                                                     |
| `'boolean'`              | per lookups                            | `true`/`false`/`1`/`0`, any case. **Anything else ignores the filter** (no error) unless `strictBooleans`.                                                                                                                                  |
| `'uuid'`                 | per lookups                            | Any version; dashes optional; `{…}` and `urn:uuid:` allowed; normalized to lowercase dashed.                                                                                                                                                |
| `'date'`                 | per lookups                            | `2024-01-05`, `2024-1-5`, `01/05/2024`, `01/05/24`, `Jan 5 2024`, `5 January, 2024`, …                                                                                                                                                      |
| `'datetime'`             | per lookups                            | **ISO 8601 only**: `2024-01-05`, `2024-01-05T10:30`, `2024-01-05 10:30:00.123`, `…Z`, `…+05:30`. No offset = in `timeZone`. A time that doesn't exist or is ambiguous in that zone (DST) is a 400.                                          |
| `'time'`                 | per lookups                            | `HH:MM`, `HH:MM:SS`, `HH:MM:SS.ffffff`.                                                                                                                                                                                                     |
| `'choice'`               | per lookups                            | Must equal a choice exactly. **Not trimmed** (`' active'` is invalid).                                                                                                                                                                      |
| `'multipleChoice'`       | `?status=a&status=b` (repeated)        | Each value must be a choice. OR by default, AND with `conjoined`. An empty value is a 400.                                                                                                                                                  |
| `'modelChoice'`          | `?company=3` (+ lookups)               | The related model's primary key (type from that key).                                                                                                                                                                                       |
| `'modelMultipleChoice'`  | `?company=1&company=4` (repeated)      | Primary keys; OR.                                                                                                                                                                                                                           |
| `'range'`                | `?price_min=` / `?price_max=`          | Numbers. One bound → `>=` / `<=`; both → BETWEEN (inclusive).                                                                                                                                                                               |
| `'dateFromToRange'`      | `?created_after=` / `?created_before=` | Dates (the `date` formats). On a datetime column: whole days in `timeZone` (from 00:00 on `after` to the end of `before`).                                                                                                                  |
| `'datetimeFromToRange'`  | `?created_after=` / `?created_before=` | Datetimes (ISO); `>=` / `<=`.                                                                                                                                                                                                               |
| `'custom'`               | per lookups (usually just `?name=`)    | The raw string, passed to `method` (required).                                                                                                                                                                                              |

The suffixes (`_min`/`_max`, `_after`/`_before`) are appended to the filter's key:
`created: { type: 'dateFromToRange', field: 'created_at' }` → `?created_after=&created_before=`.

### 6.1 Value rules for every filter (django-filter semantics)

- Missing param, `?name=` and whitespace-only strings: the filter is **skipped** (not "match empty").
- `0`, `false`, negative numbers are real values, never treated as missing.
- A repeated param uses its **last** value (`?status=a&status=b` → `b`), except `multipleChoice` /
  `modelMultipleChoice`, which read all values.
- Invalid values are collected: one invalid value throws that error; several throw one
  `FilterValidationError` with `code: 'invalid_filters'` and every error in `details.errors`. No filter is
  applied (and no method runs) unless all values are valid.

### 6.2 `in` and `range` lookups (comma-separated values)

- `?age__in=18,25` → `IN (18, 25)`. `?age__range=18,30` → `BETWEEN 18 AND 30` (inclusive; exactly two
  values, otherwise 400).
- Values are **not trimmed** around commas at split time; each value is then parsed by the filter type
  (numbers/strings trim themselves, choices do not: `?status__in=a, b` is a 400 for a choice filter).
- Empty tokens: for text/choices they are the empty string (`?name__in=john,` matches `''` too); for other
  types they are dropped. `?x__in=` (empty) skips the filter.
- More than `security.maxInValues` (100) values → `SecurityLimitError`.

### 6.3 `exclude`

`{ field: 'age', exclude: true }` → `NOT (age = 18 AND age IS NOT NULL)`: rows where the column is NULL are
**kept**, as in Django.

### 6.4 Model-choice filters and `applyAsync()`

`?company=999` (a key that doesn't exist): with `apply()` it simply matches nothing; with
`await filtering.applyAsync(...)` it is a 400 (`InvalidValueError`), as in django-filter.

`queryset` restricts which related rows are allowed and is enforced **in SQL by both** `apply()` and
`applyAsync()`:

```js
defineFilterSet({ company: { type: 'modelChoice', queryset: () => ({ public: true }) } });
```

`queryset` **must be synchronous and return a where object** (keys are column names). A function that
returns a promise (any `async` function), `undefined` (forgot `return`), `null`, an array or a primitive
throws `ConfigurationError` — under both `apply()` and `applyAsync()`. It is never awaited. If the
restriction depends on data you must load, load it first and pass it in via `request` or `view`.

## 7. Lookups

| Lookup                                                                            | SQL                                      | Notes                                                                                         |
| --------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `exact`                                                                           | `=` (IS NULL for a `nullValue`)          | The default.                                                                                  |
| `iexact`                                                                          | `ILIKE 'v'` (escaped)                    | Case-insensitive equality.                                                                    |
| `contains` / `icontains`                                                          | `LIKE` / `ILIKE '%v%'`                   | `%`, `_`, `\` in the value are literal.                                                       |
| `startswith` / `istartswith`                                                      | `LIKE` / `ILIKE 'v%'`                    |                                                                                               |
| `endswith` / `iendswith`                                                          | `LIKE` / `ILIKE '%v'`                    |                                                                                               |
| `gt` `gte` `lt` `lte`                                                             | `>` `>=` `<` `<=`                        |                                                                                               |
| `in`                                                                              | `IN (…)`                                 | Section 6.2.                                                                                  |
| `range`                                                                           | `BETWEEN a AND b`                        | Section 6.2.                                                                                  |
| `isnull`                                                                          | `IS NULL` / `IS NOT NULL`                | Value is a boolean (`true`/`false`/`1`/`0`).                                                  |
| `regex` / `iregex`                                                                | `~` / `~*`                               | Pattern checked (section 15).                                                                 |
| `search`                                                                          | `to_tsvector(col) @@ plainto_tsquery(v)` | PostgreSQL full-text.                                                                         |
| `date`, `time`                                                                    | cast to date / time in `timeZone`        | Datetime columns.                                                                             |
| `year`, `iso_year`, `month`, `day`, `week`, `week_day`, `iso_week_day`, `quarter` | `date_part(…)` in `timeZone`             | Date and datetime columns. `week_day`: 1 = Sunday … 7 = Saturday. `iso_week_day`: 1 = Monday. |
| `hour`, `minute`, `second`                                                        | `date_part(…)`                           | Datetime and time columns.                                                                    |
| `<transform>__<op>`                                                               | e.g. `created_at__year__gte`             | `op` ∈ `exact gt gte lt lte in range`. Only one transform.                                    |

- The **value type follows the lookup**: `created_at__year` expects an integer, `created_at__date` a date,
  `x__isnull` a boolean.
- Text lookups on a non-text column compare the column as text (`?age__icontains=1` matches 18, 41), but
  the value is still parsed with the column's type (`?age__icontains=x` is a 400), as in django-filter.
- A transform on the wrong column type (`username__year`) is a `ConfigurationError`.
- Not supported: `unaccent`, trigram, JSON/array lookups, chained transforms (`date__year`), `isnull` after a
  transform. Use a custom `method` for these.

## 8. Relationships

```js
defineFilterSet({
  company__name: { lookups: ['icontains'] }, // User.belongsTo(Company, { as: 'company' })
  company__departments__name: { lookups: ['exact'] }, // nested; Company.hasMany(Department, { as: 'departments' })
  orders__code: { lookups: ['exact', 'in', 'isnull'] }, // User.hasMany(Order, { as: 'orders' })
  tags__name: { lookups: ['exact'] }, // belongsToMany
  company: true, // model choice: ?company=3 → company_id = 3
});
```

How relationships behave:

- Each relationship filter becomes `column IN (SELECT … FROM related …)`. **No joins are added to your
  query**, so filters never duplicate rows, never change which associated rows you load, and never break
  `limit` / `offset` / `findAndCountAll` counts.
- **Each row of the model you query is returned once**, even if several related rows match. (Django
  returns such a row once per matching related row.) This is about the root model only: querying `Order`
  with `?user_id__in=1,2,3` returns every matching order.
- Two filters on the same to-many relation match **independently**:
  `?orders__code=A&orders__code__in=B` finds users with an order A and an order B (Django semantics).
- `rel__field__isnull=true` also matches rows with **no** related row (LEFT JOIN semantics).
- Soft-deleted rows of `paranoid` related models are ignored.
- Relationship filters, relationship search and relationship ordering **require `model`**.
- Paths deeper than `security.maxRelationshipDepth` (3) are a `ConfigurationError`.
- Supported association types: belongsTo, hasOne, hasMany, belongsToMany.

## 9. Search (`?search=`)

```js
createFiltering({ model: User, searchFields: ['username', '^email', '=code', '$slug', '@bio', 'company__name'] });
```

### 9.1 How the search value is split — this library's own syntax

**Search terms are comma-separated. Whitespace within a term is preserved; whitespace around commas is
ignored. Quotes group a phrase.**

| Request                                  | Terms                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `?search=rahul`                          | `rahul`                                                                 |
| `?search=rahul kumar`                    | `rahul kumar` — **one** term (matches "Rahul Kumar", not "Kumar Rahul") |
| `?search=rahul,kumar`                    | `rahul`, `kumar` — two terms                                            |
| `?search=rahul, kumar` / `rahul , kumar` | `rahul`, `kumar`                                                        |
| `?search=rahul kumar, amit sharma`       | `rahul kumar`, `amit sharma`                                            |
| `?search="john doe"` or `'john doe'`     | `john doe` — quotes removed                                             |
| `?search="smith, john"`                  | `smith, john` — a comma inside quotes is part of the term               |
| `?search=rahul,,kumar,`                  | `rahul`, `kumar` — empty terms dropped                                  |
| `?search=` / only spaces / only commas   | no search                                                               |

`\"` and `\\` are unescaped inside quotes; an unmatched quote is ordinary text. A repeated `?search=` uses
the last value. A null character is a 400 (`InvalidSearchError`). More than `maxSearchTerms` (20) terms is
a `SecurityLimitError`.

**This differs from DRF**, where `?search=rahul kumar` is two terms. To get DRF's splitting, override:

```js
import { SearchFilter, searchSmartSplit, normalizeQuery, lastValue } from 'node-query-filter';
class DrfSearchFilter extends SearchFilter {
  getSearchTerms(context) {
    return searchSmartSplit(lastValue(normalizeQuery(context.query).search) ?? '');
  }
}
// backends: [DjangoFilterBackend, DrfSearchFilter, OrderingFilter]
```

### 9.2 Matching

- **Every term must match at least one search field** (terms ANDed, fields ORed per term).
  `?search=rahul,delhi` with fields `name, team__name` finds rows where "rahul" is in name or team name,
  AND "delhi" is in name or team name.
- Field prefixes (on `searchFields` entries, **not** in the query):

| Field            | Match                                                            |
| ---------------- | ---------------------------------------------------------------- |
| `name`           | `icontains` (substring, case-insensitive) — the default          |
| `^name`          | `istartswith`                                                    |
| `=name`          | `iexact`                                                         |
| `$name`          | `iregex` (the term is a regex; checked, section 15)              |
| `@name`          | full-text `search`                                               |
| `name__<lookup>` | that lookup: `exact` or any text lookup, e.g. `username__iexact` |

- `?search=^rahul` searches for the literal text `^rahul`.
- Non-text fields are compared as text (`age` field: `?search=1` matches 18).
- Relationship fields (`company__name`, `orders__code`) work; across a to-many relation each term may be
  matched by a different related row.
- `getSearchFields: (context) => [...]` picks fields per request (synchronous).

## 10. Custom filter methods

```js
defineFilterSet({
  published: {
    type: 'boolean',
    method: ({ value, andWhere }) => andWhere({ published_on: value ? { [Op.ne]: null } : null }),
  },
  mine: {
    type: 'boolean',
    method: ({ value, context, andWhere }) => {
      if (value) andWhere({ owner_id: context.request.user.id });
    },
  },
});
```

The method receives `{ value, name, field, lookup, queryState, context, model, andWhere }`.
`context.request` and `context.view` are what you passed to `apply()` / `createFiltering()`.

**Contract — the same under `apply()` and `applyAsync()`:**

1. **Add conditions by calling `andWhere(condition)`.** There is no queryset to return (unlike Django).
2. **Return nothing** (or the `queryState`, which is what `andWhere` returns — so the one-line arrow form
   above is fine). Returning anything else, e.g. `return { published: true }`, throws `ConfigurationError`
   — it is never silently applied or ignored.
3. **Be synchronous.** An `async` method (or one returning a promise) throws `ConfigurationError`; it is
   never awaited. Load async data before calling `apply()` and pass it via `request` / `view`.
4. **Never assign `queryState.where`** or remove existing conditions: that throws `ConfigurationError`,
   because it could drop a restriction added by another backend (e.g. tenant scoping).
5. A method runs only when its param is present and non-empty, and only after all filter values validated.
6. An error thrown by the method propagates unchanged.

`value` by filter kind:

| Filter                                              | `value`                                              |
| --------------------------------------------------- | ---------------------------------------------------- |
| `type: 'custom'`                                    | the raw string (last value)                          |
| typed filter (`boolean`, `integer`, `date`, …)      | the parsed value (e.g. `true`, `18`, `'2024-01-05'`) |
| `range` / `dateFromToRange` / `datetimeFromToRange` | `{ start, stop }` (parsed; either may be `null`)     |
| `multipleChoice` / `modelMultipleChoice`            | the array of raw strings (already validated)         |

A method filter whose key is not a model attribute needs an explicit `type` (e.g. `'boolean'`, `'custom'`).

## 11. Backends (DRF `filter_backends`)

Backends run in order and share one query state. A backend is a class with `apply(context)`, an instance
of one, or a plain function `(context) => queryState | void`.

```js
import { BaseFilterBackend, DjangoFilterBackend, SearchFilter, OrderingFilter, andWhere } from 'node-query-filter';
import { Op } from 'sequelize';

class TenantFilterBackend extends BaseFilterBackend {
  apply(context) {
    const tenantId = context.request?.tenantId; // from auth, never from a query param
    // Fail closed: no tenant → match nothing.
    return andWhere(context.queryState, { tenant_id: tenantId == null ? { [Op.in]: [] } : tenantId });
  }
}

createFiltering({
  model: User,
  filterSet,
  backends: [TenantFilterBackend, DjangoFilterBackend, SearchFilter, OrderingFilter],
});
```

`context` has: `query`, `request`, `view`, `model`, `filterSet`, `config`, `security`, `queryState`
(`{ where, include, order, attributes }`), `timeZone`. Always add conditions with `andWhere`; put
restricting backends first. Read params with `normalizeQuery(context.query)`.

## 12. Ordering (`?ordering=`)

- `?ordering=-created_at,username` (`-` = descending). Whitespace around terms is ignored. A repeated
  `?ordering=` uses the last value.
- Terms not in `orderingFields` are **silently dropped** (or a 400 with `invalidOrderingBehavior: 'error'`).
- If nothing valid remains (or no param), `defaultOrdering` applies. `defaultOrdering` does **not** need to
  be in `orderingFields`.
- `orderingFields: []` (default) → clients cannot order. `'__all__'` → any model attribute (avoid on models
  with sensitive columns).
- Related fields: `orderingFields: ['company__name']` → `?ordering=company__name`. Only single-valued paths
  (belongsTo / hasOne); a to-many path is a `ConfigurationError`. Rows without a related row sort as NULL
  (last ascending, first descending). Correct together with `limit`, `offset` and your own includes.
- For stable pagination, end orderings with a unique field: `defaultOrdering: ['-created_at', 'id']`.

## 13. Time zones

- `timeZone` (default: Sequelize's `timezone` option, which defaults to UTC) is used for: `date`, `time`,
  `year` … `second` transforms; naive datetime values (`2024-01-05 10:30`); `dateFromToRange` day
  boundaries on datetime columns.
- Datetime values with an offset (`Z`, `+05:30`) are exact instants.
- `date` values are calendar dates; never shifted.
- To match a Django project, set `timeZone` to its `TIME_ZONE`.
- JavaScript dates have millisecond precision; microseconds in input are truncated.

## 14. Errors

Client errors extend `FilteringError`: `status` is `400`, `toJSON()` returns
`{ name, code, message, field, lookup, value, details }`.

| Class                                           | `code`                                                                  | When                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `InvalidValueError`                             | `invalid_value` (`invalid_regex`, `unsafe_regex`, `ambiguous_timezone`) | A value can't be parsed or isn't allowed.                          |
| `FilterValidationError`                         | `invalid_filters`                                                       | Several invalid values; see `details.errors`.                      |
| `SecurityLimitError`                            | `security_limit`                                                        | `maxInValues`, `maxFilters` or `maxSearchTerms` exceeded.          |
| `InvalidSearchError`                            | `invalid_search`                                                        | Null character in `?search=`.                                      |
| `UnknownFilterError`                            | `unknown_filter`                                                        | Unknown param, with `unknownFilterBehavior: 'error'`.              |
| `InvalidLookupError`                            | `invalid_lookup`                                                        | `field__lookup` for a lookup not enabled, with `'error'`.          |
| `UnsupportedLookupError`                        | `unsupported_lookup`                                                    | `field__suffix` where suffix isn't a lookup, with `'error'`.       |
| `InvalidOrderingError`                          | `invalid_ordering`                                                      | Disallowed ordering term, with `invalidOrderingBehavior: 'error'`. |
| `UnknownFieldError`, `InvalidRelationshipError` | …                                                                       | Never thrown by the library; available for custom backends.        |

`ConfigurationError` (`code: 'configuration_error'`) is **not** a `FilteringError`: it means the
configuration is wrong and should be a 500. Its message says what to fix. Typical causes: unknown option,
typo in a lookup, attribute or association that doesn't exist, transform on the wrong column type, two
filters producing the same param, relationship path too deep, relationship used without `model`,
to-many ordering field, a method that returns a value / is async / replaces conditions, an async or
non-object `queryset`, invalid `timeZone`.

## 15. Security

- Only declared filters, search fields and ordering fields are reachable; nothing is exposed automatically.
  Leave sensitive columns (`password_hash`, tokens) out of all of them.
- Operators come only from your configuration; client input never becomes a Sequelize operator. Nested
  objects in the query (`?age[gt]=1`) are ignored.
- All values are escaped/bound by Sequelize, including inside relationship subqueries.
- Limits (`security` option, all non-negative integers):

| Key                    | Default | Limits                                                 |
| ---------------------- | ------- | ------------------------------------------------------ |
| `maxInValues`          | 100     | values in one `__in` param                             |
| `maxFilters`           | 50      | filters applied in one request                         |
| `maxSearchTerms`       | 20      | terms in `?search=`                                    |
| `maxRelationshipDepth` | 3       | `__` hops in any configured field (checked at startup) |
| `regexMaxLength`       | 200     | length of a client regex                               |

- Client regexes (`regex`, `iregex`, `$` search fields) are rejected (400) if too long, invalid, using
  back-references, repetition counts over 255, or nested bounded repetition like `(a{1,50}){1,50}`. Don't
  enable regex lookups for untrusted clients unless needed. Set a PostgreSQL `statement_timeout`.
- Error bodies echo the rejected `value`.

## 16. Pagination and your own query options

```js
const options = filtering.apply({ query: req.query });
const { rows, count } = await User.findAndCountAll({
  ...options,
  include: [{ model: Company, as: 'company' }], // your own eager loading — safe to add
  attributes: { exclude: ['password_hash'] },
  limit,
  offset,
});
```

Filters never add joins, so counts are correct. If **you** include a to-many association in
`findAndCountAll`, pass `distinct: true` (Sequelize's own rule). To start from a base query, use
`apply({ query, initial: { where: { archived: false } } })`.

## 17. Differences from DRF / django-filter (all deliberate)

| Area                                        | DRF / Django                                    | This library                                                          |
| ------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| `?search=rahul kumar`                       | two terms (split on whitespace)                 | **one term**; separate terms with commas                              |
| Rows matched via a to-many relation         | repeated once per matching related row          | each row once                                                         |
| Multi-term search across a to-many relation | DRF 3.15+: one related row must match all terms | each term may match a different related row (DRF ≤ 3.14 behavior)     |
| Invalid / too-complex regex                 | reaches PostgreSQL → 500                        | 400 before the query                                                  |
| Large `__in` lists                          | unlimited                                       | 400 over `maxInValues` (100); likewise `maxFilters`, `maxSearchTerms` |
| Model-choice key that doesn't exist         | 400                                             | 400 with `applyAsync()`; matches nothing with `apply()`               |
| Ordering without `ordering_fields`          | serializer fields                               | clients cannot order                                                  |
| Filter `method`                             | returns a queryset                              | calls `andWhere`, returns nothing, synchronous                        |
| Date input formats                          | per locale                                      | ISO + English (`en`) formats; datetimes ISO only                      |
| Regex syntax                                | PostgreSQL                                      | must also be valid JavaScript regex syntax                            |

Everything else — param names, value parsing, empty/repeated params, lookups, transforms, relationship
semantics, search prefixes, ordering rules — matches DRF + django-filter, verified by running 283 query
strings against a real DRF project (`docs/COMPATIBILITY_MATRIX.md`).

## 18. Common mistakes

| Mistake                                              | Result                                             | Do instead                                          |
| ---------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| Calling `createFiltering` inside the request handler | Works, but re-validates every request              | Create once at module level                         |
| Omitting `model`                                     | `'auto'` types become strings; relationships throw | Pass `model`                                        |
| Expecting `?age__exact=18`                           | Ignored                                            | `?age=18` (with `'exact'` in lookups)               |
| `lookup: 'gte'` then requesting `?min_age__gte=`     | Ignored                                            | `?min_age=`                                         |
| `method: () => ({ a: 1 })` or `async` method         | `ConfigurationError`                               | `({ andWhere }) => andWhere({ a: 1 })`, synchronous |
| `queryset: async () => …` or forgetting `return`     | `ConfigurationError`                               | Synchronous function returning a where object       |
| Expecting `?search=john doe` to be two terms         | One term                                           | `?search=john,doe`                                  |
| Putting `^`/`=`/`$`/`@` in the search value          | Treated as literal text                            | Put prefixes on `searchFields` entries              |
| Not setting `orderingFields`                         | `?ordering=` is ignored                            | List allowed fields                                 |
| Mapping every error to 400                           | Config bugs look like client errors                | 400 only for `err instanceof FilteringError`        |
| Using the model name in a path (`Company__name`)     | `ConfigurationError`                               | Use the association alias (`as`)                    |

## 19. All exports

Core: `createFiltering`, `defineFilterSet`, `expandFilterFields`, `resolveFilterParam(param, filterSet, model?)`,
`DEFAULT_SECURITY`, `DEFAULT_RESERVED_PARAMS`.
Backends: `BaseFilterBackend`, `DjangoFilterBackend`, `SearchFilter`, `OrderingFilter`.
Query state: `andWhere`, `mergeIncludePath`, `hasWhereConditions`, `createQueryState`, `cloneQueryState`, `toSequelizeOptions`.
Lookups: `parseLookup`, `isKnownLookup`, `buildLookupCondition(column, lookup, value, { model })`, `escapeLike`,
`assertSafeRegex`, `ALL_LOOKUPS`, `TRANSFORMS`, `DEFAULT_LOOKUP`, `SEARCH_PREFIXES`.
Parsing: `normalizeQuery`, `lastValue`, `allValues`, `splitSearchTerms`, `searchSmartSplit`, `parseOrdering`, `splitCsv`.
Coercion: `coerceValue`, `coerceString`, `coerceInteger`, `coerceDecimal`, `coerceFloat`, `coerceBoolean`, `coerceUuid`,
`coerceDate`, `coerceDateTime`, `coerceTime`, `coerceChoice`, `resolveTimeZone`.
Errors: `FilteringError`, `FilterValidationError`, `InvalidValueError`, `SecurityLimitError`, `InvalidSearchError`,
`UnknownFilterError`, `InvalidLookupError`, `UnsupportedLookupError`, `InvalidOrderingError`, `UnknownFieldError`,
`InvalidRelationshipError`, `ConfigurationError`.

Details for each: `docs/API_REFERENCE.md`. Deeper topics: `docs/CONFIGURATION.md`, `docs/LOOKUP_MATRIX.md`,
`docs/BEHAVIORAL_SPEC.md`, `docs/SECURITY.md`, `docs/DRF_MIGRATION_GUIDE.md`, `docs/ARCHITECTURE.md`.
