# Changelog

## 1.0.0

Initial release: Django REST Framework / django-filter-style filtering, search and ordering for
Node.js + Sequelize 6 + PostgreSQL.

- **FilterSet** (`defineFilterSet`) with django-filter param naming: generated filters (`lookups`) and
  declared filters (`lookup`); the `filterFields` shorthand infers filter types from the model.
- **Filter types:** string, integer, number/decimal, float, boolean, uuid, date, datetime, time, choice,
  `multipleChoice`, `modelChoice`, `modelMultipleChoice`, `range`, `dateFromToRange`,
  `datetimeFromToRange`, and custom filter methods.
- **Lookups:** `exact`, `iexact`, `contains`, `icontains`, `startswith`, `istartswith`, `endswith`,
  `iendswith`, `gt`, `gte`, `lt`, `lte`, `in`, `range`, `isnull`, `regex`, `iregex`, `search`, and the
  date/time transforms `date`, `time`, `year`, `iso_year`, `month`, `day`, `week`, `week_day`,
  `iso_week_day`, `quarter`, `hour`, `minute`, `second`, optionally followed by a comparison
  (`created_at__year__gte`).
- **Values parsed as Django parses them**, including empty, whitespace-only, repeated and CSV params.
- **Relationships** (belongs-to, has-one, has-many, belongs-to-many, nested, paranoid models) as
  subqueries: no duplicated rows, no joins added to your query.
- **SearchFilter:** comma-separated terms (spaces stay inside a term, whitespace around commas is ignored,
  quoted phrases supported), DRF's `^ = $ @` field prefixes, explicit lookups, relationship fields.
- **OrderingFilter:** whitelist, default ordering, relationship ordering, `'__all__'`.
- **Backends:** `BaseFilterBackend`, `DjangoFilterBackend`, `SearchFilter`, `OrderingFilter`, and
  custom backends as classes, instances or functions.
- **`apply()` / `applyAsync()`**; `applyAsync()` also validates model-choice values against the database.
- **`timeZone`** option for date/time transforms and naive datetimes.
- **Errors:** `FilteringError` hierarchy (HTTP 400) and `ConfigurationError` for configuration mistakes,
  raised at startup when the model is given.
- **Security:** allowlisted filters, lookups, search and ordering fields; limits on `IN` values, filters,
  search terms and relationship depth; regular-expression checks.
- **TypeScript types** for the whole public API (`types/index.d.ts`): typed filter definitions, lookup
  names, options, backends, errors and helpers, so typos and invalid options are caught in the editor.
- **ESM and CommonJS:** `import` loads the ES module source; `require` loads a CommonJS build
  (`dist/index.cjs`, built automatically on `npm pack`, `npm publish` and installs from git).
- **DRF compatibility suite:** 283 query strings compared against a real DRF + django-filter view
  (`npm run test:compat`); results in `docs/COMPATIBILITY_MATRIX.md`.
