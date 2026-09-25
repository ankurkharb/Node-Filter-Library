// Compile-only checks (`npm run test:types`): typical usage must type-check,
// and misuse marked with @ts-expect-error must not.

import { DataTypes, Op, Sequelize } from 'sequelize';
import {
  BaseFilterBackend,
  ConfigurationError,
  DjangoFilterBackend,
  FilteringError,
  InvalidValueError,
  OrderingFilter,
  SecurityLimitError,
  SearchFilter,
  andWhere,
  createFiltering,
  defineFilterSet,
  lastValue,
  normalizeQuery,
  searchSmartSplit,
  type CreateFilteringOptions,
  type FilterContext,
  type FilteringErrorJSON,
  type FilterOptions,
  type FilterSetConfig,
  type QueryState,
} from 'node-query-filter';

const sequelize = new Sequelize('postgres://localhost/db');
const User = sequelize.define('User', { age: DataTypes.INTEGER, username: DataTypes.STRING });

const filterSet = defineFilterSet({
  age: { lookups: ['exact', 'gte', 'lte', 'in', 'range'] },
  min_age: { field: 'age', lookup: 'gte' },
  status: { type: 'choice', choices: ['active', ['pending', 'Pending']], lookups: ['exact', 'in'] },
  created_at: { lookups: ['gte', 'date', 'year', 'year__gte'] },
  company__name: ['icontains'],
  in_stock: true,
  price: { type: 'range', valueType: 'decimal' },
  published: {
    type: 'boolean',
    method: ({ value, andWhere }) => andWhere({ published_on: value ? { [Op.ne]: null } : null }),
  },
  mine: {
    type: 'boolean',
    method: ({ value, context, andWhere }) => {
      if (value) andWhere({ owner_id: context.request.user.id });
    },
  },
  company: { type: 'modelChoice', queryset: () => ({ public: true }) },
});

defineFilterSet({ filterFields: ['status'], fields: { age: { lookup: 'gte' } } });

// @ts-expect-error unknown lookup
defineFilterSet({ age: { lookups: ['greater_than'] } });
// @ts-expect-error unknown type
defineFilterSet({ age: { type: 'int' } });
// @ts-expect-error unknown option
defineFilterSet({ age: { lookups: ['exact'], lookupz: [] } });

class TenantFilterBackend extends BaseFilterBackend {
  apply(context: FilterContext): QueryState {
    const tenantId: number | undefined = context.request?.tenantId;
    return andWhere(context.queryState, { tenant_id: tenantId == null ? { [Op.in]: [] } : tenantId });
  }
}

class DrfSearchFilter extends SearchFilter {
  getSearchTerms(context: FilterContext): string[] {
    return searchSmartSplit(lastValue(normalizeQuery(context.query).search) ?? '');
  }
}

const filtering = createFiltering({
  model: User,
  filterSet,
  searchFields: ['username', '^email'],
  orderingFields: ['username', 'created_at'],
  defaultOrdering: ['-created_at', 'id'],
  backends: [TenantFilterBackend, DjangoFilterBackend, DrfSearchFilter, new OrderingFilter(), (ctx) => ctx.queryState],
  security: { maxInValues: 50 },
  timeZone: 'Asia/Kolkata',
  unknownFilterBehavior: 'error',
});

createFiltering({ model: User, filterFields: { price: ['gte', 'lte'], in_stock: ['exact'] } });
createFiltering({ filterFields: ['a'], ordering: '-id', orderingFields: '__all__' });

// @ts-expect-error typo in option name
createFiltering({ serachFields: ['username'] });
// @ts-expect-error invalid behavior
createFiltering({ unknownFilterBehavior: 'throw' });

async function handler(req: { query: Record<string, unknown> }) {
  try {
    const options: FilterOptions = filtering.apply({ query: req.query, request: req });
    await User.findAndCountAll({ ...options, limit: 20, offset: 0 });
    await User.findAll({ ...(await filtering.applyAsync({ query: '?age__gte=18' })) });
    filtering.apply({ query: new URLSearchParams('age=1'), initial: { where: { archived: false } } });
  } catch (err) {
    if (err instanceof FilteringError) {
      const status: 400 = err.status;
      return { status, body: err.toJSON() };
    }
    if (err instanceof ConfigurationError) throw err;
    throw err;
  }
}
void handler;

// ---------------------------------------------------------------------------
// Every filter type and definition option.
// ---------------------------------------------------------------------------

defineFilterSet({
  a: { type: 'auto', lookups: ['__all__'] },
  b: { type: 'string', lookups: ['iexact', 'icontains', 'startswith', 'regex', 'iregex', 'search'], strip: false },
  c: { type: 'char', allowEmpty: true },
  d: { type: 'integer', lookups: ['exact', 'gt', 'lt', 'in', 'range', 'isnull'] },
  e: { type: 'number', exclude: true },
  f: { type: 'float', lookup: 'lte' },
  g: { type: 'decimal' },
  h: { type: 'boolean' },
  i: { type: 'uuid', lookups: ['exact', 'in'] },
  j: { type: 'date', lookups: ['year', 'month__gte', 'week_day', 'iso_week_day', 'quarter'] },
  k: { type: 'datetime', lookups: ['date', 'time', 'hour__in', 'iso_year__range'] },
  l: { type: 'time', lookup: 'minute' },
  m: { type: 'choice', choices: ['a', ['b', 'B'], 1, true], nullValue: 'null' },
  n: { type: 'multipleChoice', choices: ['a', 'b'], conjoined: true },
  o: { type: 'modelChoice', path: ['company'], queryset: (context) => ({ tenant_id: context.request.tenantId }) },
  p: { type: 'modelMultipleChoice', associationPath: 'company__departments' },
  q: { type: 'range', valueType: 'integer', attribute: 'price' },
  r: { type: 'dateFromToRange', field: 'created_at' },
  s: { type: 'datetimeFromToRange', field: 'created_at' },
  t: { type: 'custom', filter: ({ value, andWhere }) => andWhere({ t: String(value) }) },
});

// Either `lookup` or `lookups`, never both.
// @ts-expect-error lookup and lookups together
defineFilterSet({ age: { lookup: 'gte', lookups: ['gte'] } });
// @ts-expect-error chained transforms are not supported
defineFilterSet({ created_at: { lookups: ['date__year'] } });
// @ts-expect-error a transform after a transform comparison
defineFilterSet({ created_at: { lookups: ['year__gte__lt'] } });
// @ts-expect-error valueType values
defineFilterSet({ price: { type: 'range', valueType: 'bigint' } });

// ---------------------------------------------------------------------------
// Methods and querysets: synchronous, add conditions with andWhere, return nothing.
// ---------------------------------------------------------------------------

defineFilterSet({
  // Every argument, with its type.
  full: {
    type: 'custom',
    method: ({ value, name, field, lookup, queryState, context, model, andWhere }) => {
      const n: string = name;
      const f: string = field;
      const l: string = lookup;
      const s: QueryState = queryState;
      const tz: string = context.timeZone.name;
      void [n, f, l, s, tz, model];
      andWhere(value ? { a: 1 } : null);
    },
  },
});
// @ts-expect-error a method must not be async
defineFilterSet({ a: { type: 'boolean', method: async ({ andWhere }) => void andWhere({ a: 1 }) } });
// @ts-expect-error a method must not return a condition
defineFilterSet({ a: { type: 'boolean', method: () => ({ a: 1 }) } });
// @ts-expect-error a queryset must not be async
defineFilterSet({ a: { type: 'modelChoice', queryset: async () => ({ a: 1 }) } });
// @ts-expect-error a queryset must return a where object
defineFilterSet({ a: { type: 'modelChoice', queryset: () => undefined } });

// ---------------------------------------------------------------------------
// createFiltering: every option, and the either-or pairs.
// ---------------------------------------------------------------------------

createFiltering({
  model: User,
  filterSet,
  searchFields: ['username', '=code', '$slug', '@bio', 'company__name', 'username__iexact'],
  getSearchFields: (context) => (context.request?.admin ? ['username', 'email'] : ['username']),
  orderingFields: ['username'],
  defaultOrdering: '-created_at',
  backends: [
    DjangoFilterBackend,
    new SearchFilter({ searchParam: 'q' }),
    new OrderingFilter({ orderingParam: 'sort' }),
  ],
  searchParam: 'q',
  orderingParam: 'sort',
  timeZone: '+05:30',
  searchConfig: 'english',
  unknownFilterBehavior: 'ignore',
  reservedParams: ['page'],
  invalidOrderingBehavior: 'error',
  strictBooleans: true,
  security: { maxInValues: 1, maxFilters: 1, maxSearchTerms: 1, maxRelationshipDepth: 1, regexMaxLength: 1 },
  view: { name: 'users' },
});
// @ts-expect-error filterSet and filterFields together
createFiltering({ filterSet, filterFields: ['a'] });
// @ts-expect-error defaultOrdering and its alias ordering together
createFiltering({ defaultOrdering: 'a', ordering: 'b' });
// @ts-expect-error unknown security option
createFiltering({ security: { maxInValue: 5 } });
// @ts-expect-error timeZone is a string
createFiltering({ timeZone: 330 });
// @ts-expect-error a backend needs apply(context)
createFiltering({ backends: [{ run: () => undefined }] });

// A configuration kept in a variable keeps its literal types with `satisfies`.
const userFilters = { age: { lookups: ['gte', 'lte'] } } satisfies FilterSetConfig;
const userOptions = {
  filterSet: defineFilterSet(userFilters),
  unknownFilterBehavior: 'error',
} satisfies CreateFilteringOptions;
createFiltering(userOptions);

// ---------------------------------------------------------------------------
// Backends: DRF override points.
// ---------------------------------------------------------------------------

class AdminOrdering extends OrderingFilter {
  getValidFields(context: FilterContext) {
    const fields = super.getValidFields(context);
    if (!context.request?.admin) fields.delete('salary');
    return fields;
  }
  getOrdering(context: FilterContext) {
    return super.getOrdering(context).slice(0, 3);
  }
}
class ScopedSearch extends SearchFilter {
  getSearchFields(context: FilterContext) {
    return [...super.getSearchFields(context), 'email'];
  }
}
createFiltering({ backends: [AdminOrdering, ScopedSearch] });

// ---------------------------------------------------------------------------
// apply() input and output; errors.
// ---------------------------------------------------------------------------

const out: FilterOptions = filtering.apply({
  request: { query: { age__gte: '18' } },
  model: User,
  view: {},
  initial: {
    where: { archived: false },
    include: [{ model: User, as: 'manager' }],
    order: [['id', 'ASC']],
    attributes: ['id'],
  },
});
User.findAll(out);
filtering.apply({ query: null });
filtering.apply({ query: { status: ['active', 'pending'] } });

function toHttp(err: unknown): { status: number; body: FilteringErrorJSON } | undefined {
  if (err instanceof InvalidValueError || err instanceof SecurityLimitError)
    return { status: err.status, body: err.toJSON() };
  if (err instanceof FilteringError) return { status: 400, body: err.toJSON() };
  if (err instanceof ConfigurationError) {
    const code: 'configuration_error' = err.code;
    void code;
  }
  return undefined;
}
void toHttp;
