# DRF → Node Filtering Migration Guide

Side-by-side translations from Django REST Framework + django-filter to **node-query-filter**.
Your clients' query strings do not change.

## Mental model

| DRF / django-filter                          | This library                              |
| -------------------------------------------- | ----------------------------------------- |
| `FilterSet`                                  | `defineFilterSet({ ... })`                |
| `class Meta: fields = {...}`                 | `{ field: { lookups: [...] } }`           |
| a declared `NumberFilter(lookup_expr='gte')` | `{ field: 'age', lookup: 'gte' }`         |
| `filterset_class`                            | `filterSet`                               |
| `filterset_fields`                           | `filterFields`                            |
| `search_fields` / `get_search_fields()`      | `searchFields` / `getSearchFields`        |
| `ordering_fields` / `ordering`               | `orderingFields` / `defaultOrdering`      |
| `filter_backends`                            | `backends`                                |
| `DEFAULT_FILTER_BACKENDS`                    | a shared `createFiltering` options object |
| `BaseFilterBackend.filter_queryset()`        | `BaseFilterBackend.apply(context)`        |
| `settings.TIME_ZONE`                         | `timeZone`                                |
| `SEARCH_PARAM` / `ORDERING_PARAM`            | `searchParam` / `orderingParam`           |
| `ValidationError` → 400                      | `FilteringError` (`err.status === 400`)   |

## A FilterSet

```python
class UserFilter(django_filters.FilterSet):
    min_age = django_filters.NumberFilter(field_name='age', lookup_expr='gte')
    status = django_filters.ChoiceFilter(choices=STATUS_CHOICES)
    tags = django_filters.MultipleChoiceFilter(field_name='tag', choices=TAG_CHOICES)
    price = django_filters.RangeFilter()
    created = django_filters.DateFromToRangeFilter(field_name='created_at')
    company = django_filters.ModelChoiceFilter(queryset=Company.objects.filter(public=True))
    not_banned = django_filters.BooleanFilter(field_name='banned', exclude=True)

    class Meta:
        model = User
        fields = {
            'username': ['exact', 'icontains'],
            'age': ['exact', 'gte', 'lte', 'in', 'range'],
            'created_at': ['date', 'year', 'year__gte'],
            'company__name': ['icontains'],
        }
```

```js
const UserFilterSet = defineFilterSet({
  min_age: { field: 'age', lookup: 'gte' },
  status: { type: 'choice', choices: STATUS_CHOICES },
  tags: { type: 'multipleChoice', field: 'tag', choices: TAG_CHOICES },
  price: { type: 'range' },
  created: { type: 'dateFromToRange', field: 'created_at' },
  company: { type: 'modelChoice', queryset: () => ({ public: true }) }, // must be synchronous
  not_banned: { type: 'boolean', field: 'banned', exclude: true },

  username: { lookups: ['exact', 'icontains'] },
  age: { lookups: ['exact', 'gte', 'lte', 'in', 'range'] },
  created_at: { lookups: ['date', 'year', 'year__gte'] },
  company__name: { lookups: ['icontains'] },
});
```

Choices can be given as Django-style `[value, label]` pairs. Types of `Meta.fields` entries are inferred
from the Sequelize model, as django-filter infers them from Django fields.

## A view

```python
class UserViewSet(ModelViewSet):
    queryset = User.objects.all()
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = UserFilter
    search_fields = ['username', '^email', 'company__name']
    ordering_fields = ['username', 'created_at']
    ordering = ['-created_at']
```

```js
const userFiltering = createFiltering({
  model: User,
  filterSet: UserFilterSet,
  backends: [DjangoFilterBackend, SearchFilter, OrderingFilter], // the default, shown for clarity
  searchFields: ['username', '^email', 'company__name'],
  orderingFields: ['username', 'created_at'],
  defaultOrdering: ['-created_at'],
  timeZone: 'Europe/Paris', // your Django TIME_ZONE
});

app.get('/users/', async (req, res, next) => {
  try {
    const options = await userFiltering.applyAsync({ query: req.query, request: req });
    const { rows, count } = await User.findAndCountAll({ ...options, limit, offset });
    res.json({ count, results: rows });
  } catch (err) {
    if (err instanceof FilteringError) return res.status(err.status).json(err.toJSON());
    next(err);
  }
});
```

Use `applyAsync` when you have model-choice filters and want django-filter's 400 for a nonexistent key;
otherwise `apply` is synchronous.

## `filterset_fields`

```python
filterset_fields = ['category', 'in_stock']
filterset_fields = {'price': ['gte', 'lte'], 'category': ['exact']}
```

```js
createFiltering({ model: Product, filterFields: ['category', 'in_stock'] });
createFiltering({ model: Product, filterFields: { price: ['gte', 'lte'], category: ['exact'] } });
```

Pass `model`: the types come from it. `category` as an association becomes `?category=<id>`, as in DRF.

## Search terms

DRF splits `?search=` on whitespace and commas. This library splits on **commas only**, so clients that
send `?search=john doe` to mean "john AND doe" should send `?search=john,doe`; `?search=john doe` now
searches for the phrase. Quoted phrases (`"john doe"`) still work as in DRF, but are not needed. To keep DRF's splitting, subclass
`SearchFilter` and return `searchSmartSplit(value)` from `getSearchTerms`.

## Custom filter methods

```python
published = django_filters.BooleanFilter(method='filter_published')

def filter_published(self, queryset, name, value):
    return queryset.filter(published_on__isnull=not value)
```

```js
defineFilterSet({
  published: {
    type: 'boolean',
    method: ({ value, andWhere }) => andWhere({ published_on: value ? { [Op.ne]: null } : null }),
  },
});
```

The method receives the parsed value, like `value` in Django. Add conditions with `andWhere` — there is no
queryset to return. **Do not translate `return queryset.filter(...)` into `return { ... }`**: a returned
condition is not applied, so it throws `ConfigurationError` instead of silently matching every row.
Methods must be synchronous (an `async` method throws `ConfigurationError` under both `apply()` and
`applyAsync()`), and assigning over `queryState.where` is rejected, because it would discard what other
backends added.

## Custom backends

```python
class IsOwnerFilterBackend(filters.BaseFilterBackend):
    def filter_queryset(self, request, queryset, view):
        return queryset.filter(owner=request.user)
```

```js
class IsOwnerFilterBackend extends BaseFilterBackend {
  apply(context) {
    return andWhere(context.queryState, { owner_id: context.request.user.id });
  }
}
```

## Dynamic search fields

```python
class CustomSearchFilter(filters.SearchFilter):
    def get_search_fields(self, view, request):
        if request.query_params.get('title_only'):
            return ['title']
        return super().get_search_fields(view, request)
```

```js
createFiltering({
  searchFields: ['title', 'body'],
  getSearchFields: ({ query, config }) => (normalizeQuery(query).title_only ? ['title'] : config.searchFields),
});
```

## Things to check when migrating

- **Time zone.** Set `timeZone` to your Django `TIME_ZONE`, or `__date` / `__year` results will differ.
- **Association aliases.** `company__name` follows the Sequelize association whose `as` is `company`.
- **camelCase models.** A param can name the attribute (`createdAt`) or its column (`created_at`); both
  resolve. For other names use `field`.
- **`ordering_fields` defaults.** DRF falls back to serializer fields; here clients cannot order until you
  list `orderingFields`.
- **Row duplication.** Django repeats a row once per matching related row unless you call `.distinct()`;
  this library never does. Clients that relied on duplicates will see each row once.
- **Error bodies.** DRF returns `{"field": ["message"]}`; this library returns `FilteringError.toJSON()`.
  If clients parse error bodies, adapt your error handler.

The remaining differences are in [BEHAVIORAL_SPEC.md](BEHAVIORAL_SPEC.md#differences-from-drf).
