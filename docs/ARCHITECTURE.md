# Architecture

```text
request.query ──► createFiltering().apply()
                    │
                    ├─ normalizeQuery            object / URLSearchParams / string → { name: string | string[] }
                    │
                    ├─ backend chain             each backend: apply(context) → queryState
                    │    ├─ custom backends       e.g. tenant scoping
                    │    ├─ DjangoFilterBackend   bind → read params → coerce → validate all → build conditions
                    │    ├─ SearchFilter          comma split → OR per term, AND across terms
                    │    └─ OrderingFilter        whitelist → default → order entries
                    │
                    └─ toSequelizeOptions        { where, order, include?, attributes? }
                                                   │
                         Model.findAll / findAndCountAll / count (+ limit / offset)
                                                   │
                                              PostgreSQL
```

## Modules

| Path                               | Role                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/filterset.js`            | `defineFilterSet`: validates and normalizes definitions (model-independent).                                                                   |
| `src/core/bind.js`                 | Binds a FilterSet to a model, once per model: resolves paths and attributes, infers `'auto'` types, validates lookups, builds the param index. |
| `src/core/createFiltering.js`      | Option validation, backend normalization, eager configuration checks, `apply` / `applyAsync`.                                                  |
| `src/core/queryState.js`           | The state passed between backends; `andWhere`; the "conditions preserved" check for filter methods.                                            |
| `src/parser/`                      | Query normalization, `QueryDict.get` / `getlist`, DRF's search split, ordering parse.                                                          |
| `src/filters/coerce.js`            | One coercer per Django form field.                                                                                                             |
| `src/filters/timezone.js`          | Time-zone validation, wall time → instant (DST-aware), SQL zone argument.                                                                      |
| `src/lookups/`                     | Lookup registry (`op`, `transform`, `transform__op`), regex checks, the condition builder.                                                     |
| `src/sequelize/model.js`           | Model introspection: attributes (by name or column), associations, type inference.                                                             |
| `src/sequelize/relations.js`       | Relationship conditions and relation ordering as subqueries.                                                                                   |
| `src/sequelize/filterCondition.js` | Bound filter + lookup + value → where fragment (root, relationship, `exclude`).                                                                |
| `src/sequelize/sql.js`             | Which Sequelize class to build SQL expressions with.                                                                                           |
| `src/backends/`                    | `BaseFilterBackend`, `DjangoFilterBackend`, `SearchFilter`, `OrderingFilter`.                                                                  |
| `src/errors/`                      | `FilteringError` hierarchy and `ConfigurationError`.                                                                                           |

## Key decisions

### Relationships are subqueries, not includes

`?company__name__icontains=goo` becomes

```sql
"User"."company_id" IN (SELECT "id" FROM "companies" AS "__dsf1" WHERE "__dsf1"."name" ILIKE '%goo%')
```

- **Django semantics.** django-filter applies each filter in its own `.filter()` call, so two filters on a
  to-many relation get separate joins. One subquery per filter reproduces that; a shared `include` cannot.
- **`isnull` across a relation** needs LEFT JOIN semantics; with subqueries it is an explicit
  "no related row, or a related row with NULL" condition.
- **No side effects on the consumer's query.** Filters add no joins, so they cannot duplicate rows, change
  which associated rows are loaded, or interact with Sequelize's `limit` + `include` subquery rewriting.
- PostgreSQL plans `IN (SELECT ...)` as a semi-join.

Chains nest (`a IN (SELECT ... WHERE b IN (SELECT ...))`); belongs-to-many goes through the junction table;
paranoid targets exclude soft-deleted rows. A trailing belongs-to on the target key collapses to the
foreign key: `?company=3` is `company_id = 3`.

### Relation ordering is a correlated subquery

`?ordering=company__name` orders by `(SELECT name FROM companies WHERE id = "User".company_id LIMIT 1)`.
An `include` would be silently wrong when Sequelize wraps the main query for `limit` alongside a to-many
include (it sorts after paginating). Only single-valued paths are allowed.

### Raw SQL policy

Normal filtering uses Sequelize operators. Subqueries are the one exception: Sequelize has no API for them.
They are generated by Sequelize's own `queryGenerator.selectQuery`, which escapes every value, and are then
embedded with `Sequelize.literal`. Aliases are generated by the library; column names come from model
metadata; no client input is ever concatenated into SQL.

### SQL expressions use the application's Sequelize

`literal`, `fn`, `col`, `cast` and `where` objects are only recognized by the Sequelize copy that created
them. With `npm link`, `file:` dependencies, monorepos or version skew, the application's Sequelize can be a
different copy from this package's, so expressions are always built with `model.sequelize.constructor`.
`Op` symbols are global (`Symbol.for`) and safe to share.

### Validate everything, then apply

`DjangoFilterBackend` parses and validates every filter before applying any (`filterset.is_valid()`), so
a method filter never runs for a request that will be rejected, and all invalid fields are reported at once.

### Coerce by lookup

The value type is a function of the lookup and the filter type (`lookupValueType`): transforms produce
integers, dates or times; `isnull` is boolean; text lookups keep the field's type, as django-filter does.

### Two error families

`FilteringError` (client, 400) and `ConfigurationError` (developer, 500). With `model` passed to
`createFiltering`, every `ConfigurationError` surfaces at startup rather than on the first request.

## Query state

```js
const queryState = {
  where: {}, // conditions, combined with Op.and by andWhere()
  include: [], // only what the caller passed in `initial`
  order: [], // replaced by OrderingFilter when an ordering applies
  attributes: undefined,
};
```

Backends receive it in `context.queryState`, add to it, and return it.

## Module system

The source in `src/` is ESM (`"type": "module"`) and is published as-is: `import` loads it directly.
`npm run build` (run automatically by `prepare`, so also on `npm pack`, `npm publish` and installs from git) bundles it with esbuild into `dist/index.cjs` for
`require`, keeping `sequelize` external so the application's own copy is used. Types are hand-written in
`types/index.d.ts` (copied to `dist/index.d.cts` for `require`); `npm run test:types` type-checks real
usage and checks the declarations list exactly the runtime exports. Runtime dependency: none besides the
`sequelize` peer.

Avoid loading both entries in one process: each has its own error classes, so an error thrown by one fails
`instanceof` checks against the other's classes.
