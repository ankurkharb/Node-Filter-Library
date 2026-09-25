import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Op } from 'sequelize';
import {
  BaseFilterBackend,
  ConfigurationError,
  DjangoFilterBackend,
  FilterValidationError,
  InvalidLookupError,
  InvalidOrderingError,
  InvalidSearchError,
  InvalidValueError,
  OrderingFilter,
  SearchFilter,
  SecurityLimitError,
  UnknownFilterError,
  UnsupportedLookupError,
  andWhere,
  createFiltering,
  defineFilterSet,
} from '../../src/index.js';
import { offlineModels, selectSql } from '../helpers.js';

const { User } = offlineModels();

describe('DjangoFilterBackend — values', () => {
  const filtering = createFiltering({
    model: User,
    filterSet: defineFilterSet({
      age: { lookups: ['exact', 'gte', 'lte', 'in', 'range', 'isnull'] },
      username: { lookups: ['exact', 'icontains', 'in'] },
      is_active: true,
      status: { type: 'choice', choices: ['active', 'pending'], lookups: ['exact', 'in'] },
    }),
    backends: [DjangoFilterBackend],
  });
  const where = (query) => filtering.apply({ query }).where;

  it('maps lookups to operators with coerced values', () => {
    assert.deepEqual(where({ age__gte: '18' }), { age: { [Op.gte]: 18 } });
    assert.deepEqual(where({ age__range: '18,30' }), { age: { [Op.between]: [18, 30] } });
    assert.deepEqual(where({ age__isnull: 'true' }), { age: { [Op.is]: null } });
  });
  it('does not swallow falsy values', () => {
    assert.deepEqual(where({ age: '0' }), { age: { [Op.eq]: 0 } });
    assert.deepEqual(where({ is_active: 'false' }), { is_active: { [Op.eq]: false } });
  });
  it('skips empty, whitespace-only and missing values', () => {
    assert.equal(where({ username: '' }), undefined);
    assert.equal(where({ username: '   ' }), undefined);
    assert.equal(where({}), undefined);
  });
  it('strips strings but not choices', () => {
    assert.deepEqual(where({ username: '  john ' }), { username: { [Op.eq]: 'john' } });
    assert.throws(() => where({ status: ' active' }), InvalidValueError);
  });
  it('ignores an unrecognized boolean (django-filter skips it)', () => {
    assert.equal(where({ is_active: 'maybe' }), undefined);
  });
  it('uses the last value of a repeated param', () => {
    assert.deepEqual(where({ age: ['1', '2'] }), { age: { [Op.eq]: 2 } });
  });
  it('keeps empty CSV tokens for text, drops them (NULL) otherwise', () => {
    assert.deepEqual(where({ username__in: 'john,' }), { username: { [Op.in]: ['john', ''] } });
    assert.deepEqual(where({ age__in: '18,' }), { age: { [Op.in]: [18] } });
    assert.deepEqual(where({ age__in: ',' }), { age: { [Op.in]: [] } });
    assert.deepEqual(where({ age__range: '18,' }), { age: { [Op.between]: [18, null] } });
  });
  it('ANDs filters', () => {
    assert.equal(where({ age__gte: '18', status: 'active' })[Op.and].length, 2);
  });
  it('reports every invalid value at once', () => {
    assert.throws(
      () => where({ age__gte: 'x' }),
      (e) => e instanceof InvalidValueError && e.field === 'age__gte',
    );
    assert.throws(
      () => where({ age__gte: 'x', status: 'nope', age__range: '1' }),
      (e) =>
        e instanceof FilterValidationError &&
        e.code === 'invalid_filters' &&
        e.details.errors
          .map((x) => x.field)
          .sort()
          .join() === 'age__gte,age__range,status',
    );
  });
  it('errors carry status 400', () => {
    try {
      where({ age: 'x' });
      assert.fail();
    } catch (err) {
      assert.equal(err.status, 400);
      assert.equal(err.toJSON().code, 'invalid_value');
    }
  });
});

describe('DjangoFilterBackend — unknown params', () => {
  const fs = defineFilterSet({ age: { lookups: ['exact', 'gte'] } });
  it('ignores unknown params by default, like django-filter', () => {
    const f = createFiltering({ model: User, filterSet: fs });
    assert.equal(f.apply({ query: { nope: '1', age__lte: '1', age__bogus: '1' } }).where, undefined);
  });
  it('classifies them with unknownFilterBehavior: error', () => {
    const f = createFiltering({ model: User, filterSet: fs, unknownFilterBehavior: 'error' });
    assert.throws(() => f.apply({ query: { nope: '1' } }), UnknownFilterError);
    assert.throws(() => f.apply({ query: { age__lte: '1' } }), InvalidLookupError);
    assert.throws(() => f.apply({ query: { age__bogus: '1' } }), UnsupportedLookupError);
    assert.doesNotThrow(() => f.apply({ query: { page: '2', limit: '5', search: 'x', ordering: 'age' } }));
  });
  it('a declared filter named like a pagination param still works', () => {
    const f = createFiltering({ model: User, filterSet: defineFilterSet({ page: { field: 'age' } }) });
    assert.deepEqual(f.apply({ query: { page: '3' } }).where, { age: { [Op.eq]: 3 } });
  });
});

describe('DjangoFilterBackend — transforms coerce by lookup', () => {
  const f = createFiltering({
    model: User,
    filterSet: defineFilterSet({ created_at: { lookups: ['year', 'week_day', 'date', 'time', 'year__gte'] } }),
    timeZone: 'Asia/Kolkata',
  });
  const sql = (query) => selectSql(User, f.apply({ query }));
  it('passes integers to date_part and converts to the configured zone', () => {
    assert.match(
      sql({ created_at__year: '2024' }),
      /date_part\('year', timezone\('Asia\/Kolkata', "User"\."created_at"\)\) = 2024/,
    );
    assert.match(sql({ created_at__year__gte: '2024' }), /\) >= 2024/);
  });
  it('shifts week_day from Django (1 = Sunday) to PostgreSQL DOW (0 = Sunday)', () => {
    assert.match(sql({ created_at__week_day: '2' }), /date_part\('dow', .*\) = 1/);
  });
  it('compares date and time transforms with strings', () => {
    assert.match(sql({ created_at__date: '2024-1-5' }), /CAST\(timezone\(.*\) AS DATE\) = '2024-01-05'/);
    assert.match(sql({ created_at__time: '5:30' }), /CAST\(timezone\(.*\) AS TIME\) = '05:30:00'/);
  });
  it('rejects a non-integer year', () => {
    assert.throws(() => f.apply({ query: { created_at__year: 'x' } }), InvalidValueError);
  });
  it("defaults to Sequelize's own timezone option", () => {
    const utc = createFiltering({ model: User, filterSet: defineFilterSet({ created_at: ['year'] }) });
    assert.match(selectSql(User, utc.apply({ query: { created_at__year: '2024' } })), /CAST\('\+00:00' AS INTERVAL\)/);
  });
});

describe('DjangoFilterBackend — relationships use subqueries', () => {
  const f = createFiltering({
    model: User,
    filterSet: defineFilterSet({
      company__name: ['icontains'],
      company__country: ['isnull'],
      company: true,
      orders__code: ['exact', 'in'],
    }),
  });
  const sql = (query) => selectSql(User, f.apply({ query }));
  it('filters through IN (SELECT ...) and adds no include', () => {
    const opts = f.apply({ query: { company__name__icontains: 'goo' } });
    assert.equal(opts.include, undefined);
    assert.match(
      selectSql(User, opts),
      /"User"\."company_id" IN \(SELECT "id" FROM "companies" AS "__dsf1" WHERE "__dsf1"\."name" ILIKE '%goo%'\)/,
    );
  });
  it('gives each filter on a to-many relation its own subquery', () => {
    const s = sql({ orders__code: 'A', orders__code__in: 'B' });
    assert.equal(s.match(/IN \(SELECT "user_id" FROM "orders"/g).length, 2);
  });
  it('isnull=true across a relation also matches rows with no related row', () => {
    assert.match(sql({ company__country__isnull: 'true' }), /"User"\."company_id" IS NULL OR "User"\."company_id" IN/);
  });
  it('filters a belongs-to by its foreign key directly', () => {
    assert.deepEqual(f.apply({ query: { company: '3' } }).where, { company_id: { [Op.eq]: 3 } });
  });
  it('requires a model for relationship filters', () => {
    const noModel = createFiltering({ filterSet: defineFilterSet({ company__name: true }) });
    assert.throws(() => noModel.apply({ query: { company__name: 'x' } }), ConfigurationError);
  });
});

describe('DjangoFilterBackend — exclude', () => {
  it('keeps NULL rows, like Django exclude()', () => {
    const f = createFiltering({
      model: User,
      filterSet: defineFilterSet({ not_age: { field: 'age', exclude: true } }),
    });
    assert.match(
      selectSql(User, f.apply({ query: { not_age: '18' } })),
      /NOT \(\("User"\."age" = 18 AND "User"\."age" IS NOT NULL\)\)/,
    );
  });
});

describe('DjangoFilterBackend — custom methods', () => {
  it('receives the coerced value and adds conditions with andWhere', () => {
    let seen;
    const f = createFiltering({
      model: User,
      filterSet: defineFilterSet({
        adult: {
          type: 'boolean',
          method: ({ value, andWhere: add }) => {
            seen = value;
            if (value) add({ age: { [Op.gte]: 18 } });
          },
        },
      }),
    });
    assert.deepEqual(f.apply({ query: { adult: 'true' } }).where, { age: { [Op.gte]: 18 } });
    assert.equal(seen, true);
  });
  it('cannot silently discard conditions added earlier in the chain', () => {
    const tenant = (ctx) => andWhere(ctx.queryState, { company_id: 1 });
    const replace = defineFilterSet({
      q: {
        type: 'custom',
        method: ({ queryState }) => {
          queryState.where = { age: 1 };
        },
      },
    });
    const spread = defineFilterSet({
      q: {
        type: 'custom',
        method: ({ queryState }) => {
          queryState.where = { ...queryState.where, age: 1 };
        },
      },
    });
    const overwrite = defineFilterSet({
      q: {
        type: 'custom',
        method: ({ queryState }) => {
          queryState.where = { ...queryState.where, company_id: 2 };
        },
      },
    });
    const run = (fs) =>
      createFiltering({ model: User, filterSet: fs, backends: [tenant, DjangoFilterBackend] }).apply({
        query: { q: 'x' },
      });
    assert.throws(() => run(replace), ConfigurationError);
    assert.throws(() => run(overwrite), ConfigurationError);
    assert.deepEqual(run(spread).where, { company_id: 1, age: 1 });
  });
});

describe('SearchFilter', () => {
  const f = createFiltering({
    model: User,
    searchFields: ['username', 'email', 'company__name'],
    backends: [SearchFilter],
  });
  it('ORs fields per term and ANDs terms (terms are comma-separated)', () => {
    const where = f.apply({ query: { search: 'john,doe' } }).where;
    assert.equal(where[Op.and].length, 2);
    assert.equal(where[Op.and][0][Op.or].length, 3);
  });
  it('keeps spaces inside a term: ?search=ankur kharb is one term', () => {
    const where = f.apply({ query: { search: 'ankur kharb' } }).where;
    assert.equal(where[Op.and], undefined);
    assert.deepEqual(where[Op.or][0], { username: { [Op.iLike]: '%ankur kharb%' } });
  });
  it('trims whitespace around commas but keeps it inside a term', () => {
    const where = f.apply({ query: { search: ' rahul kumar , amit ' } }).where;
    assert.deepEqual(where[Op.and][0][Op.or][0], { username: { [Op.iLike]: '%rahul kumar%' } });
    assert.deepEqual(where[Op.and][1][Op.or][0], { username: { [Op.iLike]: '%amit%' } });
  });
  it('whitespace-only search is no search', () => {
    assert.equal(f.apply({ query: { search: '  ,  ' } }).where, undefined);
  });
  it('reads the last value of a repeated ?search=', () => {
    const where = f.apply({ query: { search: ['john', 'zo'] } }).where;
    assert.deepEqual(where[Op.or][0], { username: { [Op.iLike]: '%zo%' } });
  });
  it('rejects null characters, like DRF', () => {
    assert.throws(() => f.apply({ query: { search: 'a\0b' } }), InvalidSearchError);
  });
  it('limits the number of terms', () => {
    const small = createFiltering({ model: User, searchFields: ['username'], security: { maxSearchTerms: 2 } });
    assert.throws(() => small.apply({ query: { search: 'a,b,c' } }), SecurityLimitError);
    assert.doesNotThrow(() => small.apply({ query: { search: 'a b c d e,f' } }), 'spaces do not create terms');
  });
  it('full-text search on a related field', () => {
    const fts = createFiltering({ model: User, searchFields: ['@company__name'] });
    assert.match(
      selectSql(User, fts.apply({ query: { search: 'google' } })),
      /IN \(SELECT "id" FROM "companies" AS "__dsf1" WHERE to_tsvector\("__dsf1"\."name"\) @@ plainto_tsquery\('google'\)\)/,
    );
  });
  it('compares non-text fields as text and supports explicit lookups', () => {
    const s = createFiltering({ model: User, searchFields: ['age', 'username__iexact'] });
    const sql = selectSql(User, s.apply({ query: { search: '1' } }));
    assert.match(sql, /CAST\("User"\."age" AS TEXT\) ILIKE '%1%'/);
    assert.match(sql, /"User"\."username" ILIKE '1'/);
  });
});

describe('OrderingFilter', () => {
  const f = createFiltering({
    model: User,
    orderingFields: ['username', 'age', 'company__name'],
    defaultOrdering: '-id',
    backends: [OrderingFilter],
  });
  const order = (query) => f.apply({ query }).order;
  it('orders by allowed fields', () => {
    assert.deepEqual(order({ ordering: '-age,username' }), [
      ['age', 'DESC'],
      ['username', 'ASC'],
    ]);
  });
  it('drops disallowed fields and falls back to the default, which is not filtered', () => {
    assert.deepEqual(order({ ordering: 'password_hash,age' }), [['age', 'ASC']]);
    assert.deepEqual(order({ ordering: 'password_hash' }), [['id', 'DESC']]);
    assert.deepEqual(order({}), [['id', 'DESC']]);
  });
  it('reads the last value of a repeated ?ordering=', () => {
    assert.deepEqual(order({ ordering: ['age', '-username'] }), [['username', 'DESC']]);
  });
  it('orders by a related field with a correlated subquery', () => {
    const [[expr, dir]] = order({ ordering: 'company__name' });
    assert.equal(dir, 'ASC');
    assert.match(
      expr.val,
      /\(SELECT "name" FROM "companies" AS "__dsf1" WHERE "__dsf1"\."id" = "User"\."company_id" LIMIT 1\)/,
    );
  });
  it('can reject invalid terms', () => {
    const strict = createFiltering({ model: User, orderingFields: ['age'], invalidOrderingBehavior: 'error' });
    assert.throws(() => strict.apply({ query: { ordering: 'password_hash' } }), InvalidOrderingError);
  });
  it("'__all__' allows model attributes only", () => {
    const all = createFiltering({ model: User, orderingFields: '__all__' });
    assert.deepEqual(all.apply({ query: { ordering: 'password_hash' } }).order, [['password_hash', 'ASC']]);
    assert.equal(all.apply({ query: { ordering: 'company__name' } }).order, undefined);
  });
});

describe('backends', () => {
  it('accepts classes, instances and plain functions', () => {
    class A extends BaseFilterBackend {
      apply(ctx) {
        return andWhere(ctx.queryState, { a: 1 });
      }
    }
    const f = createFiltering({ backends: [A, new A(), (ctx) => andWhere(ctx.queryState, { b: 2 })] });
    assert.deepEqual(f.apply().where, { [Op.and]: [{ a: 1 }, { a: 1 }, { b: 2 }] });
  });
  it('runs in order and exposes request and view', () => {
    const seen = [];
    const f = createFiltering({ backends: [(ctx) => seen.push(ctx.request.id, ctx.view)], view: 'v' });
    f.apply({ request: { id: 7, query: {} } });
    assert.deepEqual(seen, [7, 'v']);
  });
  it("keeps the caller's initial include and where", () => {
    const f = createFiltering({ model: User, filterSet: defineFilterSet({ age: true }) });
    const opts = f.apply({ query: { age: '5' }, initial: { include: ['company'], where: { id: 1 } } });
    assert.deepEqual(opts.include, ['company']);
    assert.deepEqual(opts.where, { [Op.and]: [{ id: 1 }, { age: { [Op.eq]: 5 } }] });
  });
});

describe('documented behaviors', () => {
  it('minute and second transforms', () => {
    const f = createFiltering({ model: User, filterSet: defineFilterSet({ created_at: ['minute', 'second__gte'] }) });
    const sql = selectSql(User, f.apply({ query: { created_at__minute: '30', created_at__second__gte: '15' } }));
    assert.match(sql, /date_part\('minute', timezone\(.*\)\) = 30/);
    assert.match(sql, /floor\(date_part\('second', timezone\(.*\)\)\) >= 15/);
  });
  it('getSearchFields decides the fields per request', () => {
    const f = createFiltering({
      model: User,
      searchFields: ['username', 'email'],
      getSearchFields: ({ query, config }) => (query.title_only ? ['username'] : config.searchFields),
    });
    assert.equal(f.apply({ query: { search: 'a', title_only: '1' } }).where[Op.or], undefined);
    assert.equal(f.apply({ query: { search: 'a' } }).where[Op.or].length, 2);
  });
  it('accepts Django-style [value, label] choices', () => {
    const f = createFiltering({
      model: User,
      filterSet: defineFilterSet({
        status: {
          type: 'choice',
          choices: [
            ['active', 'Active'],
            ['pending', 'Pending'],
          ],
        },
      }),
    });
    assert.deepEqual(f.apply({ query: { status: 'active' } }).where, { status: { [Op.eq]: 'active' } });
    assert.throws(() => f.apply({ query: { status: 'Active' } }), InvalidValueError);
  });
});
