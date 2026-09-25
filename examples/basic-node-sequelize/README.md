# Example: Express + Sequelize + PostgreSQL

A runnable API showing a FilterSet, the `filterFields` shorthand, search, ordering, relationship
filters, a model-choice filter validated with `applyAsync()`, a custom tenant backend, and error handling.

## Run

```bash
createdb drf_sequelize_filter_example
cd examples/basic-node-sequelize
cp .env.example .env        # adjust DATABASE_URL
npm install
npm run seed                # drops and re-creates the example tables
npm start
```

Every `/users/` request needs a tenant (the demo reads it from a header; a real app would take it from
the authenticated session). Without one, the tenant backend fails closed and returns nothing.

```bash
curl -H 'X-Tenant-Id: t1' 'http://127.0.0.1:3099/users/?age__gte=18&ordering=-created_at'
```

## Requests to try

| Request                                                                                  | Shows                                                     |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `/users/?age__gte=18`                                                                    | numeric lookup                                            |
| `/users/?username__icontains=john`                                                       | case-insensitive text                                     |
| `/users/?status__in=active,pending`                                                      | `in` on a choice filter                                   |
| `/users/?company__name__icontains=google`                                                | relationship filter                                       |
| `/users/?company__department__name__icontains=eng`                                       | nested relationship                                       |
| `/users/?company=1`                                                                      | model choice; `/users/?company=999` is a 400              |
| `/users/?created_at__year=2026`                                                          | date transform                                            |
| `/users/?created_after=2024-01-01&created_before=2026-12-31`                             | date range filter                                         |
| `/users/?search=john`                                                                    | search across `username`, `email`, `company__name`        |
| `/users/?ordering=company__name`                                                         | ordering by a related field                               |
| `/users/?age__gte=18&status=active&company__name__icontains=google&ordering=-created_at` | combined                                                  |
| `/users/?age__gte=hello`                                                                 | 400 `invalid_value`                                       |
| `/users/?status=bogus&age=x`                                                             | 400 `invalid_filters`, both errors in `details.errors`    |
| `/users/?password__icontains=x`                                                          | ignored: not a declared filter                            |
| `/products/?in_stock=false`                                                              | `filterFields` shorthand, boolean inferred from the model |
| `/products/?price__gte=cheap`                                                            | 400: the decimal type was inferred too                    |

Errors look like:

```json
{
  "error": {
    "name": "InvalidValueError",
    "code": "invalid_value",
    "message": "Enter a number.",
    "field": "age__gte",
    "lookup": "gte",
    "value": "hello"
  }
}
```

Pagination: `limit` and `offset` are applied after filtering, in `server.js`.
