import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFiltering, defineFilterSet, resolveFilterParam } from '../../src/index.js';
import { ConfigurationError } from '../../src/errors/index.js';
import { offlineModels } from '../helpers.js';

const { User } = offlineModels();

describe('param naming (django-filter semantics)', () => {
  const fs = defineFilterSet({
    age: { lookups: ['exact', 'gte', 'lte'] },
    min_age: { field: 'age', lookup: 'gte' },
    company__name: { lookups: ['icontains'] },
    created_at: { lookups: ['year', 'year__gte'] },
  });
  const param = (p) => resolveFilterParam(p, fs, User);

  it('generated filters: bare name for exact, name__lookup otherwise', () => {
    assert.deepEqual([param('age').lookup, param('age__gte').lookup], ['exact', 'gte']);
    assert.equal(param('age__exact'), null, 'django-filter never generates field__exact');
    assert.equal(param('company__name__icontains').key, 'company__name');
    assert.equal(param('created_at__year__gte').lookup, 'year__gte');
  });
  it('declared filters: only the declared name', () => {
    assert.equal(param('min_age').lookup, 'gte');
    assert.equal(param('min_age__gte'), null);
  });
  it('a bare name is not a param when exact is not enabled', () => {
    const only = defineFilterSet({ age: { lookups: ['gte'] } });
    assert.equal(resolveFilterParam('age', only, User), null);
    assert.equal(resolveFilterParam('age__gte', only, User).lookup, 'gte');
  });
  it('widget and list filters use their own params', () => {
    const w = defineFilterSet({
      price: { type: 'range', field: 'score' },
      created: { type: 'dateFromToRange', field: 'created_at' },
      status: { type: 'multipleChoice', choices: ['a'] },
    });
    assert.ok(resolveFilterParam('price_min', w, User));
    assert.ok(resolveFilterParam('price_max', w, User));
    assert.ok(resolveFilterParam('created_after', w, User));
    assert.equal(resolveFilterParam('price', w, User), null);
    assert.equal(resolveFilterParam('status', w, User).lookup, 'in');
  });
});

describe('type inference from the model (filterset_fields)', () => {
  const infer = (spec) => {
    const f = createFiltering({ model: User, filterFields: spec });
    return (key) => f.filterSet && resolveFilterParam(key, f.filterSet, User)?.filter;
  };
  it('maps Sequelize types to filter types', () => {
    const get = infer(['age', 'score', 'is_active', 'uid', 'created_at', 'username', 'company']);
    assert.equal(get('age').valueType, 'integer');
    assert.equal(get('score').valueType, 'float');
    assert.equal(get('is_active').valueType, 'boolean');
    assert.equal(get('uid').valueType, 'uuid');
    assert.equal(get('created_at').valueType, 'datetime');
    assert.equal(get('username').valueType, 'string');
  });
  it('an association name becomes a ModelChoice filter on the related key', () => {
    const f = infer(['company'])('company');
    assert.equal(f.type, 'modelChoice');
    assert.equal(f.valueType, 'integer');
  });
});

describe('configuration errors are ConfigurationError (not client errors)', () => {
  const cases = {
    'unknown option': () => defineFilterSet({ age: { lookupz: ['gte'] } }),
    'lookup and lookups': () => defineFilterSet({ age: { lookup: 'gte', lookups: ['lte'] } }),
    'unknown lookup': () => defineFilterSet({ age: { lookups: ['greater'] } }),
    'unknown type': () => defineFilterSet({ age: { type: 'int' } }),
    'choice without choices': () => defineFilterSet({ s: { type: 'choice' } }),
    'custom without method': () => defineFilterSet({ s: { type: 'custom' } }),
    'lookups on a widget type': () => defineFilterSet({ p: { type: 'range', lookups: ['gte'] } }),
    'unknown range valueType': () => defineFilterSet({ p: { type: 'range', valueType: 'bigint' } }),
    'unknown attribute': () => createFiltering({ model: User, filterSet: defineFilterSet({ nope: true }) }),
    'unknown association': () => createFiltering({ model: User, filterSet: defineFilterSet({ nope__name: true }) }),
    'transform on a text column': () =>
      createFiltering({ model: User, filterSet: defineFilterSet({ username: ['year'] }) }),
    'time transform on a date-only type (no model: validated on first apply)': () =>
      createFiltering({ filterSet: defineFilterSet({ d: { type: 'date', lookups: ['hour'] } }) }).apply(),
    'duplicate params': () =>
      createFiltering({ model: User, filterSet: defineFilterSet({ age: ['gte'], age__gte: { field: 'age' } }) }),
    'unknown createFiltering option': () => createFiltering({ serachFields: [] }),
    'unknown security option': () => createFiltering({ security: { maxIn: 1 } }),
    'bad security value': () => createFiltering({ security: { maxInValues: -1 } }),
    'bad time zone': () => createFiltering({ timeZone: 'Nowhere/Land' }),
    'bad backend': () => createFiltering({ backends: [42] }),
    'filterSet and filterFields': () => createFiltering({ filterSet: defineFilterSet({}), filterFields: ['a'] }),
    'plain object as filterSet': () => createFiltering({ filterSet: { fields: new Map() } }),
    'unknown search field': () => createFiltering({ model: User, searchFields: ['nope'] }),
    'unknown ordering field': () => createFiltering({ model: User, orderingFields: ['nope'] }),
    'to-many ordering': () => createFiltering({ model: User, orderingFields: ['orders__code'] }),
    'unknown default ordering': () => createFiltering({ model: User, defaultOrdering: '-nope' }),
    'relationship depth': () =>
      createFiltering({ filterSet: defineFilterSet({ a__b__c__d: true }), security: { maxRelationshipDepth: 2 } }),
  };
  for (const [name, fn] of Object.entries(cases)) {
    it(name, () => assert.throws(fn, ConfigurationError));
  }
});
