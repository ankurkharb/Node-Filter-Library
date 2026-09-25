# Lookup Matrix

Every Django lookup that django-filter exposes, what Django does on PostgreSQL, what this library
generates, and how closely they match. "Verified" means covered by the
[DRF compatibility suite](COMPATIBILITY_MATRIX.md), which compares returned rows against a real DRF view.

**Value coercion is keyed by the lookup, not the field.** `created_at__year` expects an integer and
`created_at__date` a date even though `created_at` is a datetime; `isnull` always expects a boolean.

## Comparison lookups

| Lookup                       | Django on PostgreSQL                        | This library (Sequelize)                                     | Status               | Verified |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------ | -------------------- | -------- |
| `exact`                      | `= v` (`IS NULL` for None)                  | `Op.eq`                                                      | Supported            | yes      |
| `iexact`                     | `UPPER(col) = UPPER(v)`                     | `Op.iLike`, `%` `_` `\` escaped                              | Supported            | yes      |
| `contains`                   | `LIKE '%v%'`, escaped                       | `Op.like`, escaped                                           | Supported            | yes      |
| `icontains`                  | `UPPER(col) LIKE UPPER('%v%')`              | `Op.iLike`, escaped                                          | Supported            | yes      |
| `startswith` / `istartswith` | `LIKE 'v%'`                                 | `Op.like` / `Op.iLike`                                       | Supported            | yes      |
| `endswith` / `iendswith`     | `LIKE '%v'`                                 | `Op.like` / `Op.iLike`                                       | Supported            | yes      |
| `gt` `gte` `lt` `lte`        | `>` `>=` `<` `<=`                           | `Op.gt` `Op.gte` `Op.lt` `Op.lte`                            | Supported            | yes      |
| `in`                         | `IN (...)`, CSV param                       | `Op.in`                                                      | Supported            | yes      |
| `range`                      | `BETWEEN a AND b`, exactly 2 CSV values     | `Op.between`                                                 | Supported            | yes      |
| `isnull`                     | `IS [NOT] NULL`; LEFT JOIN across relations | `Op.is` / `Op.not`; "no related row" branch across relations | Supported            | yes      |
| `regex` / `iregex`           | `~` / `~*`                                  | `Op.regexp` / `Op.iRegexp`, pattern checked                  | Supported (stricter) | yes      |
| `search`                     | `to_tsvector(col) @@ plainto_tsquery(v)`    | same, via `Sequelize.fn`                                     | Supported            | yes      |

Text lookups (`iexact`, `contains`, …, `regex`) on a non-text column compare `CAST(col AS text)`, as
Django does. As in django-filter, the _value_ is still parsed with the field's type: `?age__icontains=x`
is a 400 because `x` is not a number.

## Transforms

Datetime columns are converted with `timezone(<timeZone>, col)` first — Django's `AT TIME ZONE` with
`USE_TZ = True` — so the result does not depend on the database session.

| Lookup            | Django                                           | This library                                 | Column types   | Status    | Verified   |
| ----------------- | ------------------------------------------------ | -------------------------------------------- | -------------- | --------- | ---------- |
| `date`            | `(col AT TIME ZONE tz)::date`                    | `CAST(timezone(tz, col) AS date)`            | datetime       | Supported | yes        |
| `time`            | `::time`                                         | `CAST(... AS time)`                          | datetime       | Supported | yes        |
| `year`            | `EXTRACT(YEAR ...)`                              | `date_part('year', ...)`                     | date, datetime | Supported | yes        |
| `iso_year`        | `EXTRACT(ISOYEAR ...)`                           | `date_part('isoyear', ...)`                  | date, datetime | Supported | yes        |
| `month`           | `EXTRACT(MONTH ...)`                             | `date_part('month', ...)`                    | date, datetime | Supported | yes        |
| `day`             | `EXTRACT(DAY ...)`                               | `date_part('day', ...)`                      | date, datetime | Supported | yes        |
| `week`            | ISO week number                                  | `date_part('week', ...)`                     | date, datetime | Supported | yes        |
| `week_day`        | 1 = Sunday … 7 = Saturday                        | `date_part('dow', ...)`, value shifted by −1 | date, datetime | Supported | yes        |
| `iso_week_day`    | 1 = Monday … 7 = Sunday                          | `date_part('isodow', ...)`                   | date, datetime | Supported | yes        |
| `quarter`         | `EXTRACT(QUARTER ...)`                           | `date_part('quarter', ...)`                  | date, datetime | Supported | yes        |
| `hour` / `minute` | `EXTRACT(...)`                                   | `date_part(...)`                             | datetime, time | Supported | `hour` yes |
| `second`          | `EXTRACT(SECOND FROM DATE_TRUNC('second', ...))` | `floor(date_part('second', ...))`            | datetime, time | Supported | unit only  |

A transform can be followed by `exact`, `gt`, `gte`, `lt`, `lte`, `in` or `range`:
`created_at__year__gte=2024`, `created_at__date__lt=2024-01-01`, `created_at__month__in=1,2,3`.
A transform on a column type that does not support it (`username__year`) is a `ConfigurationError`.

## Not supported

| Lookup                                                                          | Why                                                                                     | Alternative                                            |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `unaccent__*`                                                                   | needs the PostgreSQL `unaccent` extension; DRF's `UnaccentedSearchFilter` also needs it | a custom `method` with `Sequelize.fn('unaccent', ...)` |
| `trigram_similar`, `trigram_word_similar`                                       | need `pg_trgm`                                                                          | a custom `method`                                      |
| JSON key paths (`data__key__...`), `contains`/`contained_by` on JSON, `has_key` | out of scope                                                                            | a custom `method` with Sequelize's JSON operators      |
| Array lookups (`overlap`, `len`, …)                                             | out of scope                                                                            | a custom `method` with `Op.overlap` etc.               |
| Chained transforms beyond one (`created_at__date__year`)                        | rarely used                                                                             | filter on `created_at__year`                           |
| `isnull` after a transform (`created_at__year__isnull`)                         | equivalent to `created_at__isnull`                                                      | `created_at__isnull`                                   |

## Search field prefixes (`searchFields`)

| Prefix / form     | Lookup                                             | Status               | Verified |
| ----------------- | -------------------------------------------------- | -------------------- | -------- |
| (none)            | `icontains`                                        | Supported            | yes      |
| `^`               | `istartswith`                                      | Supported            | yes      |
| `=`               | `iexact`                                           | Supported            | yes      |
| `$`               | `iregex` (pattern checked)                         | Supported (stricter) | yes      |
| `@`               | full-text `search`, including across relationships | Supported            | yes      |
| `field__<lookup>` | explicit lookup (`exact` or any text lookup)       | Supported            | yes      |

## Regex patterns

Client-supplied patterns (`regex`, `iregex`, `$` search fields) are checked before PostgreSQL compiles
them; a rejected pattern is a 400 (`code: 'invalid_regex'` or `'unsafe_regex'`). DRF performs no check,
so the same patterns produce a PostgreSQL error — an HTTP 500 — there. Rejected: syntax errors,
back-references, repetition counts over 255, nested bounded repetition such as `(a{1,50}){1,50}`, and
patterns longer than `regexMaxLength`. Patterns must also be valid JavaScript regular expression syntax.
Details in [SECURITY.md](SECURITY.md#regular-expressions).
