# DRF ↔ Node compatibility suite

Runs the same query strings through a real **Django REST Framework + django-filter** view and
through this library, over one PostgreSQL database, and compares the returned record IDs, row
order, HTTP status and error fields. SQL is never compared — only behavior.

```
compatibility/
  seed.sql              shared dataset (both sides read the same tables)
  views.json            per-view search_fields / ordering_fields / ordering, read by both sides
  cases.json            the query strings (283 cases), read by both sides
  drf-reference/        Django project: unmanaged models, the reference FilterSet, runner.py
  node/                 the same models, the equivalent FilterSet, runner.js
  run.js                seeds, runs both, compares, optionally writes docs/COMPATIBILITY_MATRIX.md
```

## Run it

```bash
createdb drf_compat                                   # disposable: its tables are dropped
python3 -m venv compatibility/drf-reference/.venv
compatibility/drf-reference/.venv/bin/pip install -r compatibility/drf-reference/requirements.txt

TEST_DATABASE_URL=postgres://localhost:5432/drf_compat npm run test:compat
TEST_DATABASE_URL=postgres://localhost:5432/drf_compat npm run test:compat -- --write   # regenerate the matrix
```

Set `DRF_PYTHON` to use a Python other than `compatibility/drf-reference/.venv/bin/python`.
Both sides run in the time zone `Asia/Kolkata` (DRF `TIME_ZONE`, library `timeZone`), chosen
because it is not UTC, so time-zone mistakes cannot hide.

The exit code is 1 if any case fails. A case marked `expect` in `cases.json` is a deliberate,
documented difference and is reported as **EXPECTED**, never as a pass.

## Adding a case

Add an object to `cases.json`: `{ "id", "category", "view", "query" }`, plus `"ordered": true`
when row order matters. If the filter it needs does not exist yet, declare it in **both**
`drf-reference/refapp/filters.py` and `node/filterset.js`.

## Verified against

Django 6.1.1 · djangorestframework 3.18.1 · django-filter 26.1 · PostgreSQL 17 · Sequelize 6.37.8 · Node 24.
