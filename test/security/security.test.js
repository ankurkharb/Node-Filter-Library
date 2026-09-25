import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Op } from 'sequelize';
import {
  ConfigurationError,
  FilteringError,
  InvalidValueError,
  SecurityLimitError,
  andWhere,
  createFiltering,
  defineFilterSet,
} from '../../src/index.js';
import { offlineModels, selectSql } from '../helpers.js';

const { User } = offlineModels();

const filtering = createFiltering({
  model: User,
  filterSet: defineFilterSet({
    username: { lookups: ['exact', 'icontains', 'regex'] },
    age: { lookups: ['exact', 'gte', 'in'] },
    company__name: ['icontains'],
  }),
  searchFields: ['username', '$email'],
  orderingFields: ['username'],
});
const sqlFor = (query) => selectSql(User, filtering.apply({ query }));

describe('security: field whitelist', () => {
  it('never filters on an undeclared field, however it is spelled', () => {
    for (const query of [
      { password_hash: 'h1' },
      { password_hash__icontains: 'h' },
      { company__country: 'US' },
      { company__password: 'x' },
      { 'username;password_hash': 'x' },
    ]) {
      assert.equal(filtering.apply({ query }).where, undefined, JSON.stringify(query));
    }
  });
});

describe('security: operator injection', () => {
  it('only declared lookups become operators', () => {
    for (const p of ['age__gt', 'age__lte', 'age__regex', 'age__$gt', 'age__[Op.gt]', 'age__or', 'username__iregex']) {
      assert.equal(filtering.apply({ query: { [p]: '1' } }).where, undefined, p);
    }
  });
  it('object-shaped query values are dropped, not interpreted', () => {
    assert.equal(filtering.apply({ query: { age: { gt: '1' }, username: { $ne: 'x' } } }).where, undefined);
  });
});

describe('security: SQL injection', () => {
  it('values are escaped by Sequelize, including inside relationship subqueries', () => {
    const payload = "x'); DROP TABLE users; --";
    assert.match(sqlFor({ username: payload }), /"username" = 'x''\); DROP TABLE users; --'/);
    assert.match(sqlFor({ company__name__icontains: payload }), /ILIKE '%x''\); DROP TABLE users; --%'/);
    const search = createFiltering({ model: User, searchFields: ['username', 'company__name'] });
    assert.match(
      selectSql(User, search.apply({ query: { search: payload } })),
      /ILIKE '%x''\); DROP TABLE users; --%'/,
    );
    // Against a regex search field the same term is an invalid pattern: rejected before any SQL.
    assert.throws(() => filtering.apply({ query: { search: payload } }), InvalidValueError);
  });
  it('LIKE wildcards in values are literal', () => {
    assert.deepEqual(filtering.apply({ query: { username__icontains: '%_' } }).where, {
      username: { [Op.iLike]: '%\\%\\_%' },
    });
  });
});

describe('security: ordering whitelist', () => {
  it('drops fields that are not allowed', () => {
    for (const ordering of ['password_hash', '-password_hash', 'company__name', 'age', 'username;DROP']) {
      assert.equal(filtering.apply({ query: { ordering } }).order, undefined, ordering);
    }
  });
  it('orders by nothing at all when orderingFields is not configured', () => {
    const f = createFiltering({ model: User });
    assert.equal(f.apply({ query: { ordering: 'username' } }).order, undefined);
  });
});

describe('security: relationship depth', () => {
  it('rejects configured paths deeper than maxRelationshipDepth', () => {
    assert.throws(
      () =>
        createFiltering({
          model: User,
          searchFields: ['company__departments__name'],
          security: { maxRelationshipDepth: 1 },
        }),
      ConfigurationError,
    );
  });
});

describe('security: resource limits', () => {
  it('maxInValues', () => {
    const f = createFiltering({
      model: User,
      filterSet: defineFilterSet({ age: ['in'] }),
      security: { maxInValues: 3 },
    });
    assert.throws(() => f.apply({ query: { age__in: '1,2,3,4' } }), SecurityLimitError);
    assert.doesNotThrow(() => f.apply({ query: { age__in: '1,2,3' } }));
  });
  it('maxFilters', () => {
    const f = createFiltering({
      model: User,
      filterSet: defineFilterSet({ age: ['exact', 'gte', 'lt'] }),
      security: { maxFilters: 2 },
    });
    assert.throws(() => f.apply({ query: { age: '1', age__gte: '1', age__lt: '9' } }), SecurityLimitError);
  });
  it('maxSearchTerms', () => {
    const f = createFiltering({ model: User, searchFields: ['username'], security: { maxSearchTerms: 3 } });
    assert.throws(() => f.apply({ query: { search: 'a,b,c,d' } }), SecurityLimitError);
  });
});

describe('security: regex', () => {
  it('rejects patterns PostgreSQL cannot compile safely, as a 400', () => {
    for (const pattern of ['(a{1,255}){1,255}', 'a{999}', '(x)\\1', '(']) {
      assert.throws(() => filtering.apply({ query: { username__regex: pattern } }), InvalidValueError, pattern);
      assert.throws(() => filtering.apply({ query: { search: pattern } }), FilteringError, pattern);
    }
  });
  it('rejects overly long patterns', () => {
    assert.throws(() => filtering.apply({ query: { username__regex: 'a'.repeat(500) } }), InvalidValueError);
  });
});

describe('security: custom filters and backends', () => {
  it('a custom filter cannot remove a restriction added by an earlier backend', () => {
    const tenant = (ctx) => andWhere(ctx.queryState, { company_id: 1 });
    const f = createFiltering({
      model: User,
      backends: [tenant, ...createFiltering({}).backends],
      filterSet: defineFilterSet({
        leak: {
          type: 'custom',
          method: ({ queryState }) => {
            queryState.where = {};
          },
        },
      }),
    });
    assert.throws(() => f.apply({ query: { leak: '1' } }), ConfigurationError);
  });
  it('configuration errors are never FilteringErrors (never a 400)', () => {
    assert.equal(new ConfigurationError('x') instanceof FilteringError, false);
  });
});
