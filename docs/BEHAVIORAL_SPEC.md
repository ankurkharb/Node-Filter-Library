# Behavioral Specification

For each feature: what DRF / django-filter does, what this library does, and where it is verified.
"compat" means the [DRF compatibility suite](COMPATIBILITY_MATRIX.md), which runs the same query against a
real DRF view; "unit", "security" and "integration" are the test suites in `test/`.

Verified against Django 6.1.1, djangorestframework 3.18.1, django-filter 26.1, PostgreSQL 17.

## 1. Backends

| Feature             | DRF                                                     | This library                                                                                                 | Verified     |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| `BaseFilterBackend` | `filter_queryset(request, queryset, view)`              | `apply(context)` returning `context.queryState`                                                              | unit         |
| Chaining            | `filter_backends` run in order on the previous queryset | `backends` run in order on one query state                                                                   | unit, compat |
| Default backends    | `DEFAULT_FILTER_BACKENDS`                               | `[DjangoFilterBackend, SearchFilter, OrderingFilter]`; share a `createFiltering` config for a global default | —            |
| Function backends   | —                                                       | `(context) => queryState` accepted                                                                           | unit         |

## 2. FilterSet and params

| Feature                                           | DRF / django-filter                                                              | This library                                                | Verified          |
| ------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------- |
| Generated filters                                 | `Meta.fields = {'age': ['exact', 'gte']}` → params `age`, `age__gte`             | `age: { lookups: ['exact', 'gte'] }` → same params          | unit, compat      |
| `field__exact`                                    | never generated: `?age__exact=` is ignored                                       | ignored                                                     | unit, compat      |
| Declared filter                                   | `min_age = NumberFilter(field_name='age', lookup_expr='gte')` → only `?min_age=` | `min_age: { field: 'age', lookup: 'gte' }` → same           | unit, compat      |
| `filterset_fields`                                | filter class inferred from the model field                                       | `filterFields`, type inferred from the Sequelize attribute  | unit, integration |
| FK in `filterset_fields`                          | `ModelChoiceFilter`                                                              | `modelChoice` (`?company=3`)                                | unit, compat      |
| Unknown param                                     | ignored                                                                          | ignored (or rejected with `unknownFilterBehavior: 'error'`) | unit, compat      |
| Lookup not enabled (`?age__lte=` when only `gte`) | not a param → ignored                                                            | ignored                                                     | unit, compat      |
| Bare name when `exact` is not enabled             | not a param → ignored                                                            | ignored                                                     | unit              |
| Several filters                                   | AND, each in its own `.filter()`                                                 | AND, each its own condition                                 | unit, compat      |
| Invalid values                                    | `is_valid()` fails → 400 listing every invalid field                             | one error, or `invalid_filters` with all of them            | unit, compat      |
| Repeated param                                    | `QueryDict.get` → last value                                                     | last value                                                  | unit, compat      |

## 3. Values

| Input                                               | django-filter                                      | This library                          | Verified     |
| --------------------------------------------------- | -------------------------------------------------- | ------------------------------------- | ------------ |
| Missing param                                       | filter skipped                                     | skipped                               | compat       |
| `?name=`                                            | `''` ∈ EMPTY_VALUES → skipped                      | skipped (`allowEmpty` to match `''`)  | compat       |
| `?name=%20%20john%20`                               | `CharField(strip=True)` → `john`                   | `john`                                | compat       |
| `?name=%20%20`                                      | strips to `''` → skipped                           | skipped                               | compat       |
| `?status=%20active` (ChoiceFilter)                  | not stripped → 400                                 | 400                                   | compat       |
| `?age=0`, `?is_active=false`                        | real values                                        | real values (never "falsy → skipped") | unit, compat |
| `?age=18.7`                                         | NumberFilter → Decimal → `int()` → 18              | 18                                    | compat       |
| `?age=1e1`, `?age=+18`, `?score=.5`                 | accepted                                           | accepted                              | compat       |
| `?score=nan`, `inf`                                 | 400                                                | 400                                   | compat       |
| `?is_active=maybe`                                  | BooleanWidget → None → skipped                     | skipped (`strictBooleans` for a 400)  | compat       |
| `?is_active=TRUE`, `1`, `False`, `0`                | accepted, any case                                 | accepted                              | compat       |
| `?uid=` any version, undashed, `{...}`, `urn:uuid:` | accepted                                           | accepted                              | compat       |
| `?created_at=01/01/2024 05:30`                      | IsoDateTimeFilter → 400                            | 400                                   | compat       |
| `?created_at=2024-01-01 05:30`                      | naive → `TIME_ZONE`                                | naive → `timeZone`                    | compat       |
| naive datetime in a DST gap/overlap                 | 400                                                | 400                                   | unit         |
| `?created_at__date=Jan 1 2024`                      | DateField input formats                            | accepted                              | compat       |
| `?x__in=a,b`                                        | CSV, not trimmed                                   | same                                  | compat       |
| `?x__in=a,`                                         | `['a', '']`; `''` is `''` for text, NULL otherwise | same                                  | unit, compat |
| `?x__in=`                                           | `[]` → skipped                                     | skipped                               | compat       |
| `?x__range=a` / `a,b,c`                             | 400 "Range query expects two values."              | 400                                   | compat       |
| `?x__range=18,`                                     | `BETWEEN 18 AND NULL` → no rows                    | same                                  | compat       |
| `?x__isnull=true/false/1/0`                         | BooleanFilter                                      | same                                  | compat       |

## 4. Filter types

| django-filter                                                                                                                | This library                                                                                            | Verified            |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------- |
| `CharFilter`, `NumberFilter`, `BooleanFilter`, `UUIDFilter`, `DateFilter`, `IsoDateTimeFilter`, `TimeFilter`, `ChoiceFilter` | `string`, `integer`/`number`/`decimal`/`float`, `boolean`, `uuid`, `date`, `datetime`, `time`, `choice` | compat              |
| `MultipleChoiceFilter` (`?s=a&s=b`, OR; `conjoined` AND; empty value → 400)                                                  | `multipleChoice`                                                                                        | compat              |
| `ModelChoiceFilter` / `ModelMultipleChoiceFilter`                                                                            | `modelChoice` / `modelMultipleChoice`; existence validated by `applyAsync()`                            | compat, integration |
| `RangeFilter` (`_min` / `_max`)                                                                                              | `range`                                                                                                 | compat              |
| `DateFromToRangeFilter` (`_after` / `_before`, whole days in `TIME_ZONE`, including month, year and leap-day boundaries)     | `dateFromToRange`                                                                                       | compat              |
| `DateTimeFromToRangeFilter`                                                                                                  | `datetimeFromToRange`                                                                                   | compat              |
| `BaseInFilter` / `BaseRangeFilter`                                                                                           | the `in` / `range` lookups on any type                                                                  | compat              |
| `ChoiceFilter(null_label=...)` → `?x=null` is IS NULL                                                                        | `nullValue: 'null'`                                                                                     | compat              |
| `Filter(exclude=True)` → `NOT (cond AND col IS NOT NULL)`                                                                    | `exclude: true`                                                                                         | unit, compat        |
| `Filter(method=...)`                                                                                                         | `method` (receives the coerced value; adds conditions with `andWhere`; synchronous, returns nothing)    | unit                |
| `DateRangeFilter` (`today`, `past week`, …), `LookupChoiceFilter`, `OrderingFilter` (django-filter's)                        | not implemented                                                                                         | —                   |

## 5. Relationships

| Feature                               | Django                                     | This library                           | Verified                                 |
| ------------------------------------- | ------------------------------------------ | -------------------------------------- | ---------------------------------------- |
| `company__name__icontains`            | INNER JOIN                                 | `company_id IN (SELECT ...)`           | compat                                   |
| Nested (`company__departments__name`) | chained joins                              | nested subqueries                      | compat                                   |
| To-many, one filter                   | join; a row per matching child             | subquery; each row once                | compat (EXPECTED where DRF repeats rows) |
| Two filters on one to-many relation   | separate joins: each matched independently | separate subqueries: same              | compat, integration                      |
| `rel__field__isnull=true`             | LEFT JOIN: also rows with no related row   | explicit "no related row" branch: same | compat, integration                      |
| `exclude` across a relation           | keeps rows with a NULL foreign key         | same                                   | compat                                   |
| Belongs-to-many                       | join through the junction table            | subquery through the junction table    | integration                              |
| Paranoid related models               | n/a                                        | soft-deleted rows excluded             | integration                              |
| Depth                                 | unlimited                                  | `maxRelationshipDepth` (3), at startup | security                                 |

## 6. Search

| Feature                              | DRF                                                                    | This library                                                                                                                                     | Verified                                                          |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Param                                | `?search=`, last value                                                 | same                                                                                                                                             | unit, compat                                                      |
| Splitting                            | `search_smart_split`: whitespace, commas, quoted phrases, `\"` escapes | **commas only**; spaces stay inside a term, whitespace around commas ignored, empty terms dropped; quoted phrases as in DRF (`splitSearchTerms`) | unit, integration, compat (quotes PASS; unquoted spaces EXPECTED) |
| Logic                                | AND of terms, OR of fields per term                                    | same                                                                                                                                             | compat                                                            |
| Prefixes `^ = $ @`                   | istartswith, iexact, iregex, search                                    | same                                                                                                                                             | compat                                                            |
| `field__lookup` entries              | explicit lookup                                                        | same (`exact` and text lookups)                                                                                                                  | compat                                                            |
| Non-text fields                      | compared as text                                                       | same                                                                                                                                             | compat                                                            |
| Null character                       | 400                                                                    | 400                                                                                                                                              | unit, compat                                                      |
| Empty / whitespace-only              | no-op                                                                  | no-op                                                                                                                                            | compat                                                            |
| Multi-term across a to-many relation | 3.15+: one related row must match all terms                            | each term may match a different related row (DRF ≤ 3.14)                                                                                         | compat (EXPECTED)                                                 |

## 7. Ordering

| Feature                                             | DRF                                                            | This library                                           | Verified                  |
| --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ | ------------------------- |
| `?ordering=-a,b`                                    | yes, last value of a repeated param                            | same                                                   | unit, compat              |
| Whitespace, empty terms, duplicates                 | stripped, dropped, kept                                        | same                                                   | compat                    |
| Invalid terms (`password_hash`, `-`, `--age`, `pk`) | silently dropped                                               | dropped (`invalidOrderingBehavior: 'error'` to reject) | unit, compat              |
| Nothing valid                                       | `get_default_ordering` — **not** filtered by `ordering_fields` | same                                                   | unit, compat, integration |
| `ordering_fields` absent                            | serializer fields                                              | nothing orderable (no serializers)                     | security                  |
| `'__all__'`                                         | model fields                                                   | model attributes                                       | unit, compat              |
| Related field (`company__name`)                     | LEFT JOIN, NULLs last ascending                                | correlated subquery, same order                        | compat, integration       |

## 8. Time zones

Django evaluates transforms and interprets naive datetimes in `TIME_ZONE`; this library uses `timeZone`
(default: Sequelize's `timezone`, else UTC), converting columns with `timezone()` so the database session
is irrelevant. The compatibility suite runs both sides in `Asia/Kolkata`, and its data includes
timestamps near midnight, so a time-zone mistake changes results.

## 9. Pagination

Filtering happens in the database before pagination; the library returns `where` / `order` only and never
adds joins, so `limit`, `offset` and `findAndCountAll` counts are unaffected by filters. Verified with
to-many includes and `limit` in `integration`.

## Differences from DRF

Each is deliberate and appears as **EXPECTED** in the compatibility matrix, or is covered by tests.

| Difference                                                                                                | Why                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationship filters return each row once; Django repeats a row per matching related row.                 | Duplicate rows are almost never wanted; DRF users add `.distinct()`. Subqueries give this for free.                                                                                                                                                   |
| `?search=` is split on commas only (`rahul kumar` is one term; `rahul, kumar` gives `rahul` and `kumar`). | A product decision for this library: phrases with spaces can be searched without quoting. DRF also splits unquoted text on whitespace; quoted phrases behave the same in both. Override `getSearchTerms` with `searchSmartSplit` for DRF's splitting. |
| Multi-term search across a to-many relation lets each term match a different related row.                 | DRF changed this in 3.15; reproducing 3.15 needs correlated multi-join subqueries. This is DRF ≤ 3.14 behavior.                                                                                                                                       |
| Invalid or unsafe regexes are a 400.                                                                      | DRF passes them to PostgreSQL, which errors (500).                                                                                                                                                                                                    |
| `maxInValues`, `maxFilters`, `maxSearchTerms`.                                                            | Resource limits DRF does not have.                                                                                                                                                                                                                    |
| Model-choice existence validated only by `applyAsync()`.                                                  | It needs a query; `apply()` is synchronous. A `queryset` restriction is enforced in SQL by both, and must be a synchronous function returning a where object (anything else is a `ConfigurationError`).                                               |
| A filter `method` adds conditions with `andWhere` and returns nothing; Django's returns a queryset.       | There is no queryset object. Returning a value or a promise throws `ConfigurationError` rather than being ignored.                                                                                                                                    |
| Clients cannot order without `orderingFields`.                                                            | There are no serializers to derive a default from; deny by default.                                                                                                                                                                                   |
| Only one transform per lookup; no `isnull` after a transform.                                             | Rarely used; see [LOOKUP_MATRIX.md](LOOKUP_MATRIX.md#not-supported).                                                                                                                                                                                  |
| Datetime and time values are truncated to milliseconds.                                                   | JavaScript `Date` precision.                                                                                                                                                                                                                          |
| Date formats are Django's English (`en`) input formats.                                                   | Other locales are not reproduced.                                                                                                                                                                                                                     |
| Regex patterns must also be valid JavaScript syntax.                                                      | The syntax check uses the JavaScript parser.                                                                                                                                                                                                          |
