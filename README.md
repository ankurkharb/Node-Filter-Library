# drf-sequelize-filter

**Ready-made filtering, search and sorting for Node.js APIs built on Sequelize + PostgreSQL.**
Stop hand-writing `if (req.query.something)` for every field. Say which fields can be filtered, and your
API understands URLs like this, with validation included:

```text
GET /users?age__gte=18&status__in=active,pending&search=rahul&ordering=-created_at
```

That reads like a sentence: _users aged 18 or more, whose status is active or pending, matching "rahul",
newest first._ The library turns it into Sequelize `where` and `order` options, and Sequelize writes the SQL.

![Node.js ≥ 18](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![TypeScript types included](https://img.shields.io/badge/types-included-3178C6?logo=typescript&logoColor=white)
![ESM and CommonJS](https://img.shields.io/badge/module-ESM%20%2B%20CommonJS-informational)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

---

## The problem

Every list endpoint ends up needing filters: by age, by status, by date, by name, by a related table. In
Node there is no standard way to do it, so we write them by hand, endpoint after endpoint:

```js
// Without this library: one endpoint, three filters.
app.get('/users', async (req, res) => {
  const conditions = [];
  if (req.query.min_age !== undefined) {
    const age = Number(req.query.min_age);
    if (Number.isNaN(age)) return res.status(400).json({ error: 'min_age must be a number' });
    conditions.push({ age: { [Op.gte]: age } });
  }
  if (req.query.status) {
    const statuses = String(req.query.status).split(',');
    if (!statuses.every((s) => ['active', 'pending'].includes(s))) {
      return res.status(400).json({ error: 'invalid status' });
    }
    conditions.push({ status: { [Op.in]: statuses } });
  }
  if (req.query.name) {
    const escaped = String(req.query.name).replace(/[\\%_]/g, '\\$&'); // easy to forget
    conditions.push({ username: { [Op.iLike]: `%${escaped}%` } });
  }
  // ...then sorting, search, date ranges, related tables, and the same again for the next endpoint.
  res.json(await User.findAll({ where: { [Op.and]: conditions }, order: [['created_at', 'DESC']] }));
});
```

It's repetitive, every endpoint ends up with slightly different parameter names, and each one is a place
to forget a check.

## The solution

Install the library and describe your filters once:

```js
import { createFiltering, defineFilterSet } from 'drf-sequelize-filter';

const userFiltering = createFiltering({
  model: User,
  filterSet: defineFilterSet({
    age: { lookups: ['exact', 'gte', 'lte', 'range'] },
    status: { type: 'choice', choices: ['active', 'pending'], lookups: ['exact', 'in'] },
    username: { lookups: ['icontains', 'istartswith'] },
    created_at: { lookups: ['gte', 'lte', 'year'] },
  }),
  searchFields: ['username', 'email'],
  orderingFields: ['username', 'created_at', 'age'],
});

app.get('/users', async (req, res) => {
  res.json(await User.findAll(userFiltering.apply({ query: req.query })));
});
```

That endpoint now supports 11 filters, search and sorting. Every value is checked (`?age__gte=abc` gets a
clear 400, see [Quick start](#quick-start) for the error handler), and the names work the same way on
every endpoint you build.

---

## Why developers like it

- **Filters you can read.** `age__gte=18` is "age greater than or equal to 18". `name__icontains=rahul` is
  "name contains rahul, any case". Your frontend team and API users can learn it in a minute (see the
  [cheat sheet](#cheat-sheet)).
- **Lots of filters, ready to use.** 18 lookups (`exact`, `icontains`, `gte`, `in`, `range`, `isnull`,
  `regex`, full-text `search`, …), 13 date and time parts like `year`, `month` and `week_day`, and filter
  types for numbers, dates, times, UUIDs, enums, ranges and related records.
- **Validation built in.** Wrong values become a clear JSON 400 error that names the field, before anything
  reaches your database.
- **Filter through relationships.** `?company__name__icontains=acme` follows your Sequelize associations.
  No extra joins are added to your query, so rows are never duplicated and pagination counts stay right.
- **Search and sorting included.** `?search=rahul kumar` and `?ordering=-created_at,username`, limited to
  the fields you allow.
- **Safe by default.** Only fields you list can be filtered, searched or sorted. Values are always escaped,
  and there are limits against abusive queries.
- **TypeScript support.** Types are included, and your editor catches typos like `serachFields` or an
  unknown lookup before you run anything.
- **Works with any framework:** Express, Fastify, Koa, NestJS or plain `http`, from `import` or `require`.
- **Thoroughly tested.** Unit, security and PostgreSQL integration tests, plus 283 queries compared against
  the original Python implementation it is modelled on (below).

---

## Cheat sheet

| Your URL                            | Means                                                        |
| ----------------------------------- | ------------------------------------------------------------ |
| `?age=18`                           | age is exactly 18                                            |
| `?age__gte=18` / `?age__lt=65`      | age ≥ 18 / age < 65                                          |
| `?age__range=18,30`                 | age between 18 and 30 (inclusive)                            |
| `?status__in=active,pending`        | status is active or pending                                  |
| `?username__icontains=rah`          | username contains "rah", ignoring case                       |
| `?username__istartswith=ra`         | username starts with "ra", ignoring case                     |
| `?email__isnull=true`               | email is empty (NULL)                                        |
| `?created_at__year=2024`            | created in 2024                                              |
| `?created_at__date__gte=2024-01-01` | created on or after 1 January 2024                           |
| `?company__name__icontains=acme`    | the related company's name contains "acme"                   |
| `?search=rahul kumar`               | any search field contains "rahul kumar"                      |
| `?search=rahul,delhi`               | matches "rahul" **and** matches "delhi" (commas split terms) |
| `?ordering=-created_at,username`    | newest first, then by username                               |

The pattern is always `field__lookup=value`. Only the filters you declare are available.

---

## Coming from Python and Django?

Then you already know this library. It follows Django REST Framework and django-filter: the same URL
syntax, the same lookup names, and the same idea of declaring a FilterSet. Moving an API from Django to
Node, or working in both, means no new syntax to learn:

| Django REST Framework / django-filter               | drf-sequelize-filter                                |
| --------------------------------------------------- | --------------------------------------------------- |
| `class UserFilter(FilterSet)`                       | `defineFilterSet({ ... })`                          |
| `filterset_fields = ['status']`                     | `filterFields: ['status']`                          |
| `search_fields`, `ordering_fields`, `ordering`      | `searchFields`, `orderingFields`, `defaultOrdering` |
| `filter_backends`                                   | `backends`                                          |
| `NumberFilter(field_name='age', lookup_expr='gte')` | `{ field: 'age', lookup: 'gte' }`                   |

**Compatibility is measured, not claimed.** 283 query strings run against a real DRF + django-filter
project and against this library, on the same database: **275 identical, 8 documented differences, 0
failures** ([compatibility matrix](docs/COMPATIBILITY_MATRIX.md)). The
[migration guide](docs/DRF_MIGRATION_GUIDE.md) has side-by-side examples.

You don't need to know Python or Django to use this library, though. Everything in this README is plain
Node.js.

---

## Contents

[Install](#install) · [Quick start](#quick-start) · [Declaring filters](#declaring-filters) ·
[Filter types](#filter-types) · [Lookups](#lookups) · [Relationships](#relationships) · [Search](#search) ·
[Ordering](#ordering) · [Custom filters & backends](#custom-filters-and-backends) ·
[Errors](#validation-and-errors) · [Time zones](#time-zones) · [Pagination](#pagination) ·
[Security](#security) · [Differences from DRF](#differences-from-drf) · [Docs](#documentation)

> **Using an AI coding assistant, or want everything in one place?** [AGENTS.md](AGENTS.md) is a single,
> complete guide to every option, filter type, lookup, rule and error. After installing, it is at
> `node_modules/drf-sequelize-filter/AGENTS.md`.

---

## Install

```bash
npm install drf-sequelize-filter sequelize pg pg-hstore
```

- Node.js 18 or newer, with `import` (ESM) or `require` (CommonJS)
- Sequelize 6 (`^6.37`) and PostgreSQL. Other databases are not supported.
- TypeScript types included, no `@types` package needed. If you keep a configuration in a variable, add
  `satisfies FilterSetConfig` (or `satisfies CreateFilteringOptions`) so TypeScript keeps lookup names
  like `'gte'` exact

---

## Quick start

```js
import { createFiltering, defineFilterSet, FilteringError } from 'drf-sequelize-filter';

// 1. Describe the filters once, when your app starts.
const UserFilterSet = defineFilterSet({
  age: { lookups: ['exact', 'gte', 'lte', 'range', 'in'] }, // ?age=  ?age__gte=  ?age__range=18,30
  username: { lookups: ['exact', 'icontains'] },
  status: { type: 'choice', choices: ['active', 'pending'], lookups: ['exact', 'in'] },
  company__name: { lookups: ['icontains'] }, // follows the `company` association
  created_at: { lookups: ['gte', 'lt', 'date', 'year'] },
});

const userFiltering = createFiltering({
  model: User, // checks the whole configuration at startup
  filterSet: UserFilterSet,
  searchFields: ['username', 'email', 'company__name'],
  orderingFields: ['username', 'created_at', 'age'],
  defaultOrdering: ['-created_at', 'id'],
});

// 2. Apply it in each request. Works with any framework: pass the query object, URLSearchParams or a string.
app.get('/users', async (req, res, next) => {
  try {
    const options = userFiltering.apply({ query: req.query, request: req });
    const { rows, count } = await User.findAndCountAll({ ...options, limit: 20, offset: 0 });
    res.json({ count, results: rows });
  } catch (err) {
    // Bad input from the client: a 400 with a helpful message.
    if (err instanceof FilteringError) return res.status(err.status).json({ error: err.toJSON() });
    next(err); // anything else, including ConfigurationError, is a server error
  }
});
```

By default the filters run first, then search, then ordering. You can add your own steps, for example to
limit every query to the current tenant (see [backends](#custom-filters-and-backends)).

---

# Reference

## Declaring filters

`defineFilterSet` has two ways to declare a filter. They differ in how the URL parameters are named.
(Django users: these are django-filter's `Meta.fields` and declared filters, with the same naming.)

**A list of lookups** (`lookups: [...]`) gives one parameter per lookup. `exact` uses the bare name, and
every other lookup is `name__lookup`. There is no `age__exact`.

```js
defineFilterSet({ age: { lookups: ['exact', 'gte'] } }); // ?age=  ?age__gte=
```

**A single lookup** (`lookup: '...'`) gives exactly one parameter, named after the key. Use it for a
friendly name like `min_age` (django-filter: `NumberFilter(field_name='age', lookup_expr='gte')`).

```js
defineFilterSet({ min_age: { field: 'age', lookup: 'gte' } }); // ?min_age=   (and not ?min_age__gte=)
```

**`filterFields`** is a shortcut when you just want some fields filterable (DRF's `filterset_fields`).
Types come from your Sequelize model, so `?age__gte=hello` is a 400 and never reaches the database.

```js
createFiltering({ model: Product, filterFields: ['category', 'in_stock'] });
createFiltering({ model: Product, filterFields: { price: ['gte', 'lte'], in_stock: ['exact'] } });
```

Options for a filter definition:

| Option               | Meaning                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `type`               | Filter type (below). Default `'auto'`: inferred from the model attribute.                       |
| `lookups` / `lookup` | Generated params per lookup, or a single declared lookup. Not both.                             |
| `field`              | Attribute (or column name) if it differs from the key. Default: the key's last `__` segment.    |
| `path`               | Association aliases to follow, if not given in the key (`company__name` implies `['company']`). |
| `choices`            | For `choice` / `multipleChoice`: values or Django-style `[value, label]` pairs.                 |
| `method`             | Custom filter function (django-filter `method=`).                                               |
| `exclude`            | Negate the filter, keeping NULL rows (django-filter `exclude=True`).                            |
| `strip`              | Strip whitespace from string values. Default `true` (Django `CharField`).                       |
| `allowEmpty`         | For strings: `?name=` matches the empty string instead of being skipped.                        |
| `conjoined`          | For `multipleChoice`: require all values (AND) instead of any (OR).                             |
| `nullValue`          | For choices: a value (e.g. `'null'`) meaning IS NULL (django-filter `null_label`).              |
| `queryset`           | For model choices: `(context) => where` restricting allowed related rows.                       |
| `valueType`          | For `range`: `'integer' \| 'float' \| 'decimal'`.                                               |

Mistakes in any of these — an unknown option, a typo'd lookup, an attribute or association that does not
exist, a transform on a text column, two filters claiming the same param — throw `ConfigurationError`
when `createFiltering` is given the model, i.e. at startup.

---

## Filter types

| `type`                | django-filter                       | Params                               | Value parsing                                                |
| --------------------- | ----------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `auto` (default)      | inferred                            | per lookups                          | from the Sequelize attribute type                            |
| `string` / `char`     | `CharFilter`                        | per lookups                          | stripped                                                     |
| `integer`             | `NumberFilter` on an integer column | per lookups                          | Decimal syntax, truncated toward zero (`18.7` → `18`)        |
| `number` / `decimal`  | `NumberFilter`                      | per lookups                          | Decimal syntax, kept as a string (no precision loss)         |
| `float`               | `NumberFilter` on a float column    | per lookups                          | finite numbers only                                          |
| `boolean`             | `BooleanFilter`                     | per lookups                          | `true/false/1/0`, any case; anything else ignores the filter |
| `uuid`                | `UUIDFilter`                        | per lookups                          | any version; dashes, braces, `urn:uuid:` optional            |
| `date`                | `DateFilter`                        | per lookups                          | ISO `2024-01-05`, `01/05/2024`, `Jan 5 2024`, …              |
| `datetime`            | `IsoDateTimeFilter`                 | per lookups                          | ISO 8601; naive values are in [`timeZone`](#time-zones)      |
| `time`                | `TimeFilter`                        | per lookups                          | `HH:MM[:SS[.ffffff]]`                                        |
| `choice`              | `ChoiceFilter`                      | per lookups                          | must be a choice; **not** stripped                           |
| `multipleChoice`      | `MultipleChoiceFilter`              | `?status=a&status=b`                 | OR (or AND with `conjoined`)                                 |
| `modelChoice`         | `ModelChoiceFilter`                 | `?company=3`                         | related primary key                                          |
| `modelMultipleChoice` | `ModelMultipleChoiceFilter`         | `?company=1&company=4`               | related primary keys                                         |
| `range`               | `RangeFilter`                       | `?price_min=` `?price_max=`          | numbers                                                      |
| `dateFromToRange`     | `DateFromToRangeFilter`             | `?created_after=` `?created_before=` | dates; whole days in `timeZone`                              |
| `datetimeFromToRange` | `DateTimeFromToRangeFilter`         | `?created_after=` `?created_before=` | datetimes                                                    |
| `custom`              | `Filter(method=...)`                | per lookups                          | raw string, passed to `method`                               |

With `type: 'auto'`, an **association name** becomes a `modelChoice` filter: `filterFields: ['company']`
gives `?company=3`, as in django-filter.

A model-choice value that does not exist is a 400 in django-filter, which needs a query. `apply()` is
synchronous, so there it simply matches nothing; use `await filtering.applyAsync(...)` to get the 400.
A `queryset` restriction is enforced in SQL by both.

`queryset` must be **synchronous** and return a where object for the related model. A function that returns
a promise (an `async` function), `undefined`, `null`, an array or a primitive throws `ConfigurationError` —
under `apply()` and `applyAsync()` alike — rather than silently dropping the restriction.

---

## Lookups

| Lookup                                                                                                        | SQL (via Sequelize)                                         |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `exact`, `gt`, `gte`, `lt`, `lte`                                                                             | `=`, `>`, `>=`, `<`, `<=`                                   |
| `iexact`                                                                                                      | `ILIKE` with wildcards escaped                              |
| `contains`, `startswith`, `endswith`                                                                          | `LIKE` with `%`, `_`, `\` escaped                           |
| `icontains`, `istartswith`, `iendswith`                                                                       | `ILIKE`, escaped                                            |
| `in`                                                                                                          | `IN (...)` — comma-separated, `?status__in=a,b`             |
| `range`                                                                                                       | `BETWEEN a AND b` — exactly two values, `?age__range=18,30` |
| `isnull`                                                                                                      | `IS NULL` / `IS NOT NULL`                                   |
| `regex`, `iregex`                                                                                             | `~`, `~*` (patterns are [checked](#security))               |
| `search`                                                                                                      | `to_tsvector(col) @@ plainto_tsquery(value)`                |
| `date`, `time`                                                                                                | `CAST(... AS date / time)` in `timeZone`                    |
| `year`, `iso_year`, `month`, `day`, `week`, `week_day`, `iso_week_day`, `quarter`, `hour`, `minute`, `second` | `date_part(...)` in `timeZone`                              |
| `<transform>__<op>`                                                                                           | e.g. `created_at__year__gte`, `created_at__date__lt`        |

Text lookups on non-text columns compare the column cast to text, as Django does (`?age__icontains=1`).
Values are always coerced by the lookup: `created_at__year` expects an integer, `created_at__date` a date.
The full matrix, with Django semantics and every limitation, is in [docs/LOOKUP_MATRIX.md](docs/LOOKUP_MATRIX.md).

---

## Relationships

Follow Sequelize associations with `__`, using the association alias (`as`):

```js
defineFilterSet({
  company__name: { lookups: ['icontains'] }, // User.belongsTo(Company, { as: 'company' })
  company__departments__name: { lookups: ['icontains'] }, // → Company.hasMany(Department, { as: 'departments' })
  orders__code: { lookups: ['exact', 'in', 'isnull'] }, // User.hasMany(Order, { as: 'orders' })
  tags__name: { lookups: ['exact'] }, // belongsToMany
});
```

Each relationship filter becomes `column IN (SELECT ... FROM related ...)`. That gives Django's semantics —
two filters on a to-many relation are matched independently (`?orders__code=A&orders__code__in=B` finds a
user with an order A and an order B), and `isnull=true` also matches rows with no related row — and it
never adds joins to your query, so it cannot duplicate rows, change which associated rows you load, or
break `limit`. Soft-deleted rows of `paranoid` models are excluded, as a Sequelize include would.

Relationship filters need the `model`. Paths deeper than `security.maxRelationshipDepth` (default 3) are
rejected at startup.

---

## Search

```js
createFiltering({ model: User, searchFields: ['username', '^email', '=code', '$slug', '@bio', 'company__name'] });
```

| Field            | Lookup                                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| `name`           | `icontains`                                                                 |
| `^name`          | `istartswith`                                                               |
| `=name`          | `iexact`                                                                    |
| `$name`          | `iregex`                                                                    |
| `@name`          | full-text `search` (set `searchConfig` to pick a text-search configuration) |
| `name__<lookup>` | that lookup, e.g. `username__iexact`                                        |

**Search terms are comma-separated. Whitespace within a term is preserved, while whitespace surrounding
comma separators is ignored.**

| Request                                                     | Terms                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `?search=rahul,kumar`                                       | `rahul` and `kumar` — two terms                                    |
| `?search=rahul, kumar` (or `rahul ,kumar`, `rahul , kumar`) | `rahul` and `kumar` — whitespace around a comma is ignored         |
| `?search=rahul kumar`                                       | `rahul kumar` — one term; matches "Rahul Kumar", not "Kumar Rahul" |
| `?search=rahul kumar, amit sharma`                          | `rahul kumar` and `amit sharma`                                    |
| `?search=  rahul kumar  `                                   | `rahul kumar` — whitespace at the edges of a term is trimmed       |
| `?search=rahul,,kumar,`                                     | `rahul` and `kumar` — empty terms are dropped                      |
| `?search="john doe"` (or `'john doe'`)                      | `john doe` — surrounding quotes are removed, as in DRF             |
| `?search="john doe", rahul kumar`                           | `john doe` and `rahul kumar`                                       |
| `?search="smith, john"`                                     | `smith, john` — a comma inside quotes is part of the term          |

Terms are matched with the field's lookup (substring `icontains` by default), so `?search=rahul` matches
"Rahul Kumar".

Quotes are optional — an unquoted phrase is already one term — but work as in DRF: a term wrapped in
matching `"` or `'` is unquoted (`\"` and `\\` are unescaped), and commas inside the quotes do not split
it. An unmatched quote is ordinary text. The field prefixes above (`^`, `=`, …) belong in `searchFields`, not in
the query: `?search=^ankur` searches for the text `^ankur`. **Every term must match at least one field**
(AND of ORs). Null characters are a 400, as in DRF. `getSearchFields: (context) => [...]` is the
equivalent of `get_search_fields()`.

This differs from DRF, which also splits unquoted text on whitespace (`?search=JOHN doe` is two terms there).
For DRF's splitting, override `getSearchTerms` in a `SearchFilter` subclass and return
`searchSmartSplit(value)`.

---

## Ordering

```js
createFiltering({
  model: User,
  orderingFields: ['username', 'created_at', 'company__name'],
  defaultOrdering: '-created_at',
});
```

- `?ordering=-created_at,username`; a repeated `?ordering=` uses the last value.
- Terms not in `orderingFields` are silently dropped, as in DRF (or rejected with `invalidOrderingBehavior: 'error'`).
- If no valid term remains, `defaultOrdering` applies. Like DRF's `ordering`, it does not have to be in `orderingFields`.
- Related fields (`company__name`) are ordered by a correlated subquery, which stays correct with `limit`
  and your own includes. Only single-valued paths (belongs-to / has-one) can be ordered.
- Without `orderingFields`, clients cannot order at all. `'__all__'` allows every model attribute — prefer a list.

---

## Custom filters and backends

A filter `method` receives the **coerced** value and adds conditions with `andWhere`:

```js
defineFilterSet({
  published: {
    type: 'boolean',
    method: ({ value, andWhere }) => andWhere({ published_on: value ? { [Op.ne]: null } : null }),
  },
});
```

The method also gets `name`, `lookup`, `queryState`, `model` and the full `context` (with `request` and
`view`). The contract, the same under `apply()` and `applyAsync()`:

- **Add conditions with `andWhere`.** Unlike Django's `method=`, there is no queryset to return: a method
  returns nothing (or the `queryState`, which is what `andWhere` returns, so the arrow form above is fine).
  Returning anything else — for example the condition itself — throws `ConfigurationError`.
- **Methods are synchronous.** An `async` method, or one that returns a promise, throws `ConfigurationError`;
  it is never awaited. Load what a method needs before calling `apply()`, and pass it in through `request`
  or `view`.
- A method that removes or overwrites conditions added earlier — for example a tenant restriction from
  another backend — throws `ConfigurationError`.

These are all loud failures on purpose: a filter method is often a permission check, and a silently
ignored one would return every row.

A backend is DRF's `BaseFilterBackend`: a class with `apply(context)`, an instance, or a plain function.

```js
import { BaseFilterBackend, andWhere } from 'drf-sequelize-filter';

class TenantFilterBackend extends BaseFilterBackend {
  apply(context) {
    return andWhere(context.queryState, { tenant_id: context.request.tenantId });
  }
}

createFiltering({ backends: [TenantFilterBackend, DjangoFilterBackend, SearchFilter, OrderingFilter] });
```

Backends run in order and share one query state. See [examples/custom-backend](examples/custom-backend/TenantFilterBackend.js).

---

## Validation and errors

Every client error extends `FilteringError`, has `status = 400` and serializes with `toJSON()`:

```json
{
  "name": "InvalidValueError",
  "code": "invalid_value",
  "message": "Enter a number.",
  "field": "age__gte",
  "lookup": "gte",
  "value": "hello"
}
```

All filter values are validated before any is applied; several invalid values produce one
`FilterValidationError` with `code: 'invalid_filters'` and every error in `details.errors`, as DRF reports
all fields at once. `ConfigurationError` (your configuration is wrong) deliberately does **not** extend
`FilteringError`, so it can never become a 400. The error classes and codes are listed in
[docs/API_REFERENCE.md](docs/API_REFERENCE.md#errors).

Unknown params are ignored, as in django-filter. `unknownFilterBehavior: 'error'` rejects them instead,
distinguishing an unknown param, a lookup that is not enabled, and a suffix that is not a lookup.

---

## Time zones

Django evaluates `__date`, `__year`, `__hour`, … and interprets naive datetimes in `settings.TIME_ZONE`.
The equivalent is `timeZone` (an IANA name or `±HH:MM`). It defaults to your Sequelize instance's
`timezone` option, which itself defaults to UTC. To match a Django deployment, set it to the same value:

```js
createFiltering({ model: User, filterSet, timeZone: 'Europe/Paris' });
```

Transforms convert the column with PostgreSQL's `timezone()` before extracting, so results do not depend
on the database session. A naive datetime that falls in a DST gap or overlap is a 400, as in Django.

---

## Pagination

Filtering produces `where` and `order`; paginate after it, as DRF does:

```js
const options = filtering.apply({ query: req.query });
const { rows, count } = await User.findAndCountAll({ ...options, include: [/* your includes */], limit, offset });
```

Your own `include`s are safe to add: filters never join, so they do not affect row counts. (If _you_
include a to-many association with `findAndCountAll`, pass `distinct: true` — that is Sequelize's rule,
not the library's.) To start from a base query, pass `initial: { where, include, order }` to `apply()`.

---

## Security

Filtering is an API boundary, and the defaults are deny-by-default:

- only declared filters, search fields and ordering fields are reachable; nothing is exposed automatically;
- operators come only from your configuration, never from client input;
- all values are bound or escaped by Sequelize — including inside relationship subqueries;
- limits: `maxInValues` (100), `maxFilters` (50), `maxSearchTerms` (20), `maxRelationshipDepth` (3), `regexMaxLength` (200);
- regex patterns are checked for what actually hurts PostgreSQL (see [docs/SECURITY.md](docs/SECURITY.md)).

---

## Differences from DRF

Documented, deliberate, and each covered by the compatibility suite:

- Relationship filters return each row once; Django repeats a row per matching related row.
- `?search=` is split on commas only, so an unquoted `JOHN doe` is one term; DRF also splits on
  whitespace. Quoted phrases behave as in DRF.
- A multi-term `?search=` across a **to-many** relation lets each term match a different related row
  (DRF ≤ 3.14 behavior); DRF 3.15+ requires one related row to match all terms.
- Invalid regexes and `IN` lists over `maxInValues` are a 400 here; DRF passes them to PostgreSQL.
- Model-choice existence is only validated by `applyAsync()`.
- No serializer-based `ordering_fields` default: without `orderingFields`, clients cannot order.
- Only English/ISO date formats are accepted, like Django's default `en` locale.

The complete list, with the reasoning for each, is in [docs/BEHAVIORAL_SPEC.md](docs/BEHAVIORAL_SPEC.md#differences-from-drf).

---

## Documentation

| Document                                             | Contents                                         |
| ---------------------------------------------------- | ------------------------------------------------ |
| [AGENTS.md](AGENTS.md)                               | **Start here:** the complete single-file guide   |
| [DRF migration guide](docs/DRF_MIGRATION_GUIDE.md)   | Side-by-side DRF → Node examples                 |
| [API reference](docs/API_REFERENCE.md)               | Every export, option and error                   |
| [Configuration](docs/CONFIGURATION.md)               | `createFiltering` options and defaults           |
| [Lookup matrix](docs/LOOKUP_MATRIX.md)               | Every lookup: Django semantics, SQL, support     |
| [Behavioral spec](docs/BEHAVIORAL_SPEC.md)           | Feature-by-feature DRF behavior and ours         |
| [Compatibility matrix](docs/COMPATIBILITY_MATRIX.md) | Generated results of the 283-case DRF comparison |
| [Security](docs/SECURITY.md)                         | Threat model and protections                     |
| [Architecture](docs/ARCHITECTURE.md)                 | How it works inside                              |

Examples: [examples/basic-node-sequelize](examples/basic-node-sequelize/) (Express) ·
[compatibility/](compatibility/) (the DRF reference project).

## Development

```bash
npm test                    # unit + security; integration too when TEST_DATABASE_URL is set
npm run test:compat         # DRF comparison — see compatibility/README.md
npm run lint && npm run format:check
```

`TEST_DATABASE_URL` must point at a disposable database: the integration and compatibility suites drop
and re-create their tables.

## Versioning

SemVer. Filtering semantics are public API: a change to which rows a query returns, or whether it is
accepted, is a **major** version. See the [changelog](CHANGELOG.md).

## License

MIT
