# Research Notes

What DRF, django-filter and Django actually do, as established from their source and by running them.
Every statement marked **verified** was confirmed against a live DRF view by the
[compatibility suite](COMPATIBILITY_MATRIX.md) or a direct probe.

Versions: Django 6.1.1 · djangorestframework 3.18.1 · django-filter 26.1 · PostgreSQL 17 ·
Sequelize 6.37.8 · Node 24.

Sources: [DRF filtering guide](https://www.django-rest-framework.org/api-guide/filtering/),
[`rest_framework/filters.py`](https://github.com/encode/django-rest-framework/blob/main/rest_framework/filters.py),
[django-filter reference](https://django-filter.readthedocs.io/en/stable/ref/filterset.html),
`django_filters/rest_framework/filterset.py`, `django/utils/text.py` (`smart_split`),
`django/utils/dateparse.py`, `django/conf/locale/en/formats.py`.

## Who owns what

| Concern                                                                      | Owner                                |
| ---------------------------------------------------------------------------- | ------------------------------------ |
| Backend chaining, `SearchFilter`, `OrderingFilter`                           | DRF                                  |
| `FilterSet`, filter classes, param naming, value parsing, CSV `in` / `range` | django-filter (+ Django form fields) |
| Lookup SQL                                                                   | Django ORM on PostgreSQL             |

## DjangoFilterBackend / FilterSet

- Only filters that exist in the FilterSet read params; anything else is ignored, never an error. **verified**
- `Meta.fields = {'age': ['exact', 'gte']}` generates filters named `age` and `age__gte`. The `exact`
  filter drops the suffix (`get_filter_name` strips `__exact`), so `?age__exact=` is ignored. **verified**
- A declared filter's param is its attribute name only: `min_age = NumberFilter(lookup_expr='gte')` reads
  `?min_age=`, never `?min_age__gte=`. **verified**
- Filter classes for `filterset_fields` come from `FILTER_FOR_DBFIELD_DEFAULTS`; the DRF FilterSet swaps
  `DateTimeField` to `IsoDateTimeFilter` (ISO 8601 only). A FK becomes `ModelChoiceFilter`; `in` wraps the
  class in `BaseInFilter`, `range` in `BaseRangeFilter`, `isnull` uses `BooleanFilter`. **verified**
- Text lookups keep the field's filter class: `age__icontains` is a `NumberFilter`, so `?age__icontains=x`
  is a 400. On a field with choices, only `exact` uses `ChoiceFilter`. **verified**
- `DjangoFilterBackend.filter_queryset`: `if not filterset.is_valid() and raise_exception: raise
ValidationError(filterset.errors)` → 400 listing every invalid field. **verified**
- `Filter.filter` skips values in `EMPTY_VALUES` (`''`, `None`, `[]`, `()`, `{}`). **verified**
- Every filter is applied with its own `qs.filter(...)` call, so filters on a to-many relation get separate
  joins. **verified**

### Value parsing (Django form fields)

| Field                             | Behavior                                                                          |              |
| --------------------------------- | --------------------------------------------------------------------------------- | ------------ |
| `CharField`                       | `strip=True`; whitespace-only → `''` → skipped                                    | **verified** |
| `ChoiceField`                     | **not** stripped; `' active'` is invalid                                          | **verified** |
| `DecimalField` (NumberFilter)     | Python `Decimal` syntax (`.5`, `1e1`, `+18`); `nan`/`inf` rejected                | **verified** |
| NumberFilter on an integer column | `IntegerField.get_prep_value` → `int(Decimal)`: `18.7` matches 18                 | **verified** |
| `FloatField`                      | finite only                                                                       | **verified** |
| `BooleanWidget`                   | `true/false/1/0`, lower-cased; anything else → `None` → skipped, **not** an error | **verified** |
| `UUIDField`                       | `uuid.UUID(hex=...)`: any version, dashes optional, `{}` and `urn:uuid:` accepted | **verified** |
| `DateField`                       | `en` DATE_INPUT_FORMATS: ISO, `%m/%d/%Y`, `%m/%d/%y`, month-name forms            | **verified** |
| `IsoDateTimeField`                | `parse_datetime` only (fromisoformat + regex); `01/01/2024 05:30` → 400           | **verified** |
| naive datetimes                   | made aware in `TIME_ZONE`; nonexistent/ambiguous → 400                            | source       |
| `TimeField`                       | `%H:%M:%S`, `%H:%M:%S.%f`, `%H:%M`                                                | **verified** |

### CSV (`BaseCSVWidget`)

`''` → `[]` (skipped). Otherwise `value.split(',')` with no trimming and no dropping of empty tokens; each
token is cleaned by the element field. An empty token is `''` for text/choices and `None` otherwise, so
`?age__in=18,` is `IN (18, NULL)` and `?age__range=18,` is `BETWEEN 18 AND NULL` (no rows). `range`
requires exactly two tokens. **verified**

### Other filter classes

`MultipleChoiceFilter` reads `getlist()`; OR by default, AND with `conjoined`; an empty value is a 400.
`RangeFilter` reads `<name>_min` / `<name>_max`; one bound → `gte` / `lte`, both → `range`.
`DateFromToRangeFilter` reads `_after` / `_before` and spans whole days in `TIME_ZONE`.
`ModelChoiceFilter` rejects a key that is not in its queryset (400). `exclude=True` keeps NULL rows.
`ChoiceFilter(null_label=...)` makes `?x=null` filter `IS NULL`. **verified**

## SearchFilter (DRF 3.15+)

- `get_search_terms`: `query_params.get('search', '')` (last value) validated by
  `CharField(trim_whitespace=False)` — a null character is a **400** (DRF ≤ 3.14 silently removed it). **verified**
- `search_smart_split`: Django `smart_split` (whitespace, quoted phrases with `\` escapes), commas trimmed
  from each token; quoted tokens unescaped and kept whole; others split on commas, empty pieces dropped. **verified**
- `construct_search`: `^` istartswith, `=` iexact, `@` search, `$` iregex, otherwise `icontains`; an entry
  that already ends in a valid lookup (`username__iexact`) is used as is. **verified**
- All terms go into **one** `queryset.filter(...)`: AND of terms, OR of fields per term. Because it is one
  call, joins across a to-many relation are shared, so one related row must satisfy every term (3.15+;
  ≤ 3.14 filtered once per term). **verified**
- Non-text fields are compared as text (`?search=1` matches `age = 18`). **verified**

## OrderingFilter

- `get_ordering`: last value of `?ordering=`; `split(',')`, each term stripped; `remove_invalid_fields`
  keeps terms whose name (minus a leading `-`) is in the valid fields; duplicates are kept. **verified**
- If nothing valid remains, `get_default_ordering(view)` is returned **without** being checked against
  `ordering_fields`. **verified**
- `ordering_fields = None` → serializer fields; `'__all__'` → model fields (not related paths). **verified**
- Related fields order with a LEFT JOIN; PostgreSQL puts NULLs last ascending, first descending. **verified**

## Lookups on PostgreSQL

`exact` `=`; `iexact` `UPPER() = UPPER()`; `contains`/`startswith`/`endswith` `LIKE` and the `i` forms
`UPPER() LIKE UPPER()`, with `%` `_` `\` escaped; `in`; `range` `BETWEEN`; `isnull` (LEFT JOIN across
relations); `regex` `~`, `iregex` `~*`; `search` `to_tsvector(col) @@ plainto_tsquery(v)` with the database
default configuration. Transforms (`date`, `time`, `year`, `iso_year`, `month`, `day`, `week`, `week_day`
(1 = Sunday), `iso_week_day` (1 = Monday), `quarter`, `hour`, `minute`, `second`) evaluate
`col AT TIME ZONE <TIME_ZONE>`; a transform can be followed by a comparison (`year__gte`). **verified**

## PostgreSQL regex engine (measured)

Not backtracking for ordinary patterns: `(a+)+b` on 40,000 characters takes under 1 ms. Compiling nested
bounded repetition is expensive (`(.{1,100}){1,100}` ≈ 35 ms) or fails (`(a{1,255}){1,255}`: "too
complex"); counts over 255 are errors; back-references force backtracking. This drives the checks in
[SECURITY.md](SECURITY.md#regular-expressions).

## Sequelize facts relied on

- `Op` symbols are `Symbol.for(...)`, shared by every copy of the package; `literal` / `fn` / `col` /
  `where` / `cast` objects are recognized only by the copy that made them.
- The `timezone` option also sets the PostgreSQL session time zone (default `+00:00`).
- `findAll` with `limit` and a to-many include wraps the main query in a subquery; an ORDER BY on another
  included table is then applied after the limit.
- `queryGenerator.selectQuery(table, { attributes, where, tableAs, limit }, model)` produces escaped SQL.
