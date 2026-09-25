/**
 * Express + Sequelize + PostgreSQL example.
 *
 *   cp .env.example .env && npm install && npm run seed && npm start
 *   curl -H 'X-Tenant-Id: t1' 'http://127.0.0.1:3099/users/?age__gte=18&ordering=-created_at'
 */

import 'dotenv/config';
import express from 'express';
import {
  createFiltering,
  defineFilterSet,
  DjangoFilterBackend,
  SearchFilter,
  OrderingFilter,
  FilteringError,
} from 'node-query-filter';
import { sequelize, User, Company, Product } from './models/index.js';
import { TenantFilterBackend } from '../custom-backend/TenantFilterBackend.js';

// DRF: class UserFilter(FilterSet) + filterset_fields
const UserFilterSet = defineFilterSet({
  age: { lookups: ['exact', 'gte', 'lte', 'gt', 'lt', 'range', 'in'] },
  username: { lookups: ['exact', 'iexact', 'icontains', 'contains', 'startswith', 'endswith'] },
  status: { type: 'choice', choices: ['active', 'pending', 'inactive'], lookups: ['exact', 'in'] },
  deleted_at: { lookups: ['isnull'] },
  created_at: { lookups: ['gte', 'lt', 'date', 'year'] },
  company: true, // ModelChoiceFilter: ?company=<id>
  company__name: { lookups: ['exact', 'icontains'] },
  company__department__name: { lookups: ['icontains'] },
  created: { type: 'dateFromToRange', field: 'created_at' }, // ?created_after=&created_before=
});

// DRF view: filter_backends / filterset_class / search_fields / ordering_fields / ordering
const userFiltering = createFiltering({
  model: User,
  filterSet: UserFilterSet,
  searchFields: ['username', 'email', 'company__name'],
  orderingFields: ['username', 'created_at', 'age', 'company__name'],
  defaultOrdering: ['-created_at', 'id'],
  backends: [TenantFilterBackend, DjangoFilterBackend, SearchFilter, OrderingFilter],
  security: { maxInValues: 50, maxFilters: 30 },
});

// filterset_fields shorthand: types are inferred from the model.
const productFiltering = createFiltering({
  model: Product,
  filterFields: { in_stock: ['exact'], price: ['gte', 'lte', 'range'], name: ['icontains'] },
  searchFields: ['name'],
  orderingFields: ['price', 'name'],
  defaultOrdering: 'id',
});

const app = express();

app.use((req, _res, next) => {
  // Demo only: a real app sets this from the authenticated session.
  req.tenantId = req.get('x-tenant-id');
  next();
});

app.get('/users/', async (req, res, next) => {
  try {
    // applyAsync() also validates ?company=<id> against the database (400 if it does not exist).
    const options = await userFiltering.applyAsync({ query: req.query, request: req });
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const { rows, count } = await User.findAndCountAll({
      ...options,
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
      limit,
      offset,
    });
    res.json({ count, results: rows });
  } catch (err) {
    next(err);
  }
});

app.get('/products/', async (req, res, next) => {
  try {
    const options = productFiltering.apply({ query: req.query, request: req });
    res.json(await Product.findAll(options));
  } catch (err) {
    next(err);
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// FilteringError → 400 with a structured body; anything else (including
// ConfigurationError) is a server error.
app.use((err, _req, res, _next) => {
  if (err instanceof FilteringError) return res.status(err.status).json({ error: err.toJSON() });
  console.error(err);
  res.status(500).json({ error: { message: 'Internal Server Error' } });
});

const port = Number(process.env.PORT) || 3099;
await sequelize.authenticate();
app.listen(port, () => {
  console.log(`Example API on http://127.0.0.1:${port}`);
});
