// The CommonJS build (dist/index.cjs) must expose the same API as the ES
// module source and produce identical queries. Run with `npm run test:cjs`,
// which builds first.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize, DataTypes, Op } = require('sequelize');

const cjs = require('drf-sequelize-filter');

function offlineUser() {
  const sequelize = new Sequelize('postgres://user:pass@127.0.0.1:1/offline', { logging: false });
  const Company = sequelize.define('Company', { name: DataTypes.STRING }, { tableName: 'companies' });
  const User = sequelize.define(
    'User',
    {
      username: DataTypes.STRING,
      age: DataTypes.INTEGER,
      status: DataTypes.ENUM('active', 'pending'),
      created_at: DataTypes.DATE,
    },
    { tableName: 'users', timestamps: false },
  );
  User.belongsTo(Company, { as: 'company', foreignKey: 'company_id' });
  return User;
}

function selectSql(model, options) {
  return model.sequelize
    .getQueryInterface()
    .queryGenerator.selectQuery(model.getTableName(), { ...options, attributes: ['id'] }, model);
}

function config(lib, model) {
  return {
    model,
    filterSet: lib.defineFilterSet({
      age: { lookups: ['exact', 'gte', 'in'] },
      status: { lookups: ['exact'] },
      created_at: { lookups: ['year'] },
      company__name: { lookups: ['icontains'] },
    }),
    searchFields: ['username', 'company__name'],
    orderingFields: ['age', 'company__name'],
    defaultOrdering: ['-age'],
  };
}

test('require() resolves to the CommonJS build', () => {
  assert.equal(require.resolve('drf-sequelize-filter').endsWith('dist/index.cjs'), true);
});

test('exports the same names as the ES module', async () => {
  const esm = await import('drf-sequelize-filter');
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
});

test('produces the same SQL as the ES module', async () => {
  const esm = await import('drf-sequelize-filter');
  const User = offlineUser();
  const query =
    '?age__gte=18&age__in=20,30&status=active&created_at__year=2024&company__name__icontains=ac&search=ra&ordering=company__name';
  const fromCjs = cjs.createFiltering(config(cjs, User)).apply({ query });
  const fromEsm = esm.createFiltering(config(esm, User)).apply({ query });
  assert.equal(selectSql(User, fromCjs), selectSql(User, fromEsm));
});

test('uses the application Sequelize (Op symbols match)', () => {
  const User = offlineUser();
  const { where } = cjs.createFiltering(config(cjs, User)).apply({ query: '?age__gte=18' });
  assert.deepEqual(where, { age: { [Op.gte]: 18 } });
});

test('errors are real classes', () => {
  const User = offlineUser();
  const filtering = cjs.createFiltering(config(cjs, User));
  assert.throws(
    () => filtering.apply({ query: '?age__gte=abc' }),
    (err) => err instanceof cjs.FilteringError && err.status === 400 && err.code === 'invalid_value',
  );
  assert.throws(() => cjs.createFiltering({ serachFields: [] }), cjs.ConfigurationError);
});
