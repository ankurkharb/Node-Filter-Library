# DRF Compatibility Reference

This folder contains a minimal Django + DRF + django-filter project that mirrors
the Node example seed data, so you can compare query-parameter behavior.

## Why SQL will differ

Django ORM and Sequelize generate different SQL. Compare **result IDs / ordering /
validation outcomes**, not SQL text.

## Setup (Python)

```bash
cd compatibility/drf-reference
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# set DATABASE_URL or edit settings
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 8001
```

## Equivalent Node

```bash
cd examples/basic-node-sequelize
npm run seed && npm start
```

## Comparison matrix (manual)

| Query | Expectation |
|---|---|
| `?age__gte=18` | adults only |
| `?username__icontains=john` | john + Johnny (case-insensitive) |
| `?status__in=active,pending` | those statuses |
| `?deleted_at__isnull=true` | bob (soft-deleted) |
| `?company__name__icontains=google` | google employees |
| `?search=john` | john-ish usernames/emails |
| `?ordering=-age` | descending age |
| `?age__gte=hello` | 400 validation |

See `docs/COMPATIBILITY_MATRIX.md` for the full checklist.

## Known intentional differences

| Topic | DRF | This library |
|---|---|---|
| Unknown filter params | Ignored | Ignored (default); optional `unknownFilterBehavior: 'error'` |
| Invalid ordering fields | Silently dropped | Same |
| Boolean tokens | `true/false/1/0` via BooleanWidget | Same |
| `week_day` | Django 1=Sunday | Accepted as Django-style; converted to PG DOW |
| Full-text `@` search | Django `SearchVector` config | `to_tsvector`/`plainto_tsquery` english — partial |
| Empty filter values | Usually skip | Skip |
| Serializer-inferred ordering fields | Possible in DRF | Not supported — always whitelist |
