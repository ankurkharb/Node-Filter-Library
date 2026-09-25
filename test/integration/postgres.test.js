/**
 * PostgreSQL integration tests: assert on the rows PostgreSQL returns.
 *
 *   TEST_DATABASE_URL=postgres://localhost:5432/dsf_test npm test
 *
 * Skipped when TEST_DATABASE_URL is not set. The database is re-seeded from
 * compatibility/seed.sql (its tables are dropped) — use a disposable database.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, rm } from 'node:fs/promises';
import { DataTypes, Op, Sequelize } from 'sequelize';
import { defineModels } from '../../compatibility/node/models.js';
import { ConfigurationError, InvalidValueError, createFiltering, defineFilterSet } from '../../src/index.js';

const URL = process.env.TEST_DATABASE_URL;

if (!URL) {
  // A skipped describe() is not counted in the runner's summary; this skipped
  // test is, so "skipped 1" shows that PostgreSQL coverage did not run.
  it(
    'PostgreSQL integration tests',
    {
      skip: 'TEST_DATABASE_URL not set: no PostgreSQL integration tests ran',
    },
    () => {},
  );
}

describe('PostgreSQL integration', { skip: !URL && 'TEST_DATABASE_URL not set' }, () => {
  let sequelize;
  let User;
  let Order;
  const ids = (rows) => rows.map((r) => r.id);
  const find = async (filtering, query, extra = {}) =>
    ids(await User.findAll({ ...(await filtering.apply({ query })), attributes: ['id'], ...extra }));
  const sorted = (a) => [...a].sort((x, y) => x - y);

  before(async () => {
    sequelize = new Sequelize(URL, { logging: false });
    await sequelize.query(await readFile(new globalThis.URL('../../compatibility/seed.sql', import.meta.url), 'utf8'));
    ({ User, Order } = defineModels(sequelize));
  });
  after(async () => sequelize?.close());

  describe('date/time transforms', () => {
    const lookups = [
      'year',
      'month',
      'day',
      'week',
      'week_day',
      'iso_week_day',
      'quarter',
      'hour',
      'time',
      'date',
      'year__gte',
    ];
    it('return the right rows in the configured time zone', async () => {
      const f = createFiltering({
        model: User,
        filterSet: defineFilterSet({ created_at: { lookups } }),
        timeZone: 'Asia/Kolkata',
      });
      assert.deepEqual(sorted(await find(f, '?created_at__year=2024')), [1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13]);
      assert.deepEqual(await find(f, '?created_at__month=3&created_at__day=16'), [2]);
      assert.deepEqual(sorted(await find(f, '?created_at__week_day=2')), [1, 9, 11, 13]);
      assert.deepEqual(sorted(await find(f, '?created_at__time=05:30')), [1, 5, 6, 7, 8, 9, 10, 11, 12]);
      assert.deepEqual(sorted(await find(f, '?created_at__year__gte=2025')), [5]);
    });
    it("use Sequelize's timezone (UTC by default) when timeZone is not set", async () => {
      const f = createFiltering({ model: User, filterSet: defineFilterSet({ created_at: { lookups } }) });
      assert.deepEqual(await find(f, '?created_at__date=2024-03-15'), [2]);
      assert.deepEqual(await find(f, '?created_at__year=2023'), [4]);
    });
  });

  describe('ordering', () => {
    it('orders by a related field, correctly paginated alongside a to-many include', async () => {
      const f = createFiltering({ model: User, orderingFields: ['company__name', 'id'] });
      const options = f.apply({ query: '?ordering=company__name,id' });
      const include = [{ model: Order, as: 'orders' }];
      const page1 = ids(await User.findAll({ ...options, include, limit: 4 }));
      const page2 = ids(await User.findAll({ ...options, include, limit: 4, offset: 4 }));
      assert.deepEqual(page1, [5, 6, 13, 1]);
      assert.deepEqual(page2, [2, 12, 3, 4]);
    });
    it('applies the default ordering even when it is not an ordering field', async () => {
      const f = createFiltering({ model: User, orderingFields: ['age'], defaultOrdering: '-id' });
      assert.deepEqual((await find(f, '?ordering=password_hash')).slice(0, 3), [13, 12, 11]);
    });
  });

  describe('relationships', () => {
    let f;
    before(() => {
      f = createFiltering({
        model: User,
        filterSet: defineFilterSet({
          company__country: ['exact', 'isnull'],
          orders__code: ['exact', 'in', 'isnull'],
        }),
        searchFields: ['@company__name'],
      });
    });
    it('full-text search across a relationship', async () => {
      assert.deepEqual(sorted(await find(f, '?search=google')), [1, 2, 3, 4, 12]);
    });
    it('isnull=true matches rows with no related row (LEFT JOIN semantics)', async () => {
      assert.deepEqual(sorted(await find(f, '?company__country__isnull=true')), [11, 13]);
      assert.deepEqual(sorted(await find(f, '?orders__code__isnull=true')), [3, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    });
    it('each filter on a to-many relation matches independently', async () => {
      assert.deepEqual(await find(f, '?orders__code=A&orders__code__in=B'), [1]);
    });
    it('never duplicates parent rows, and counts are right', async () => {
      const options = f.apply({ query: '?orders__code__in=A,B' });
      assert.deepEqual(sorted(ids(await User.findAll(options))), [1, 4]);
      assert.equal(await User.count(options), 2);
      const { count, rows } = await User.findAndCountAll({
        ...options,
        include: [{ model: Order, as: 'orders' }],
        distinct: true,
        limit: 1,
      });
      assert.equal(count, 2);
      assert.equal(rows.length, 1);
    });
  });

  describe('filterFields shorthand', () => {
    let f;
    before(() => {
      f = createFiltering({ model: User, filterFields: { age: ['gte'], is_active: true, company: true } });
    });
    it('infers types, so bad input is a 400 rather than a database error', async () => {
      assert.throws(() => f.apply({ query: '?age__gte=hello' }), InvalidValueError);
      assert.deepEqual(sorted(await find(f, '?age__gte=41')), [8, 11, 12]);
      assert.deepEqual(await find(f, '?is_active=maybe'), await find(f, ''));
      assert.deepEqual(sorted(await find(f, '?company=1')), [1, 2, 12]);
    });
  });

  describe('ModelChoice validation', () => {
    let f;
    before(() => {
      f = createFiltering({
        model: User,
        filterSet: defineFilterSet({
          company: { type: 'modelChoice' },
          public_company: {
            type: 'modelChoice',
            field: 'company',
            queryset: () => ({ country: { [Op.ne]: 'US' } }),
          },
        }),
      });
    });
    it('apply(): an unknown key matches nothing; applyAsync(): 400, as in django-filter', async () => {
      assert.deepEqual(await find(f, '?company=999'), []);
      await assert.rejects(f.applyAsync({ query: '?company=999' }), InvalidValueError);
      const ok = await f.applyAsync({ query: '?company=1' });
      assert.deepEqual(sorted(ids(await User.findAll(ok))), [1, 2, 12]);
    });
    it('queryset restricts the choices in SQL even with the synchronous apply()', async () => {
      assert.deepEqual(await find(f, '?public_company=1'), []);
      assert.deepEqual(sorted(await find(f, '?public_company=4')), [7, 8]);
      await assert.rejects(f.applyAsync({ query: '?public_company=1' }), InvalidValueError);
    });
  });

  describe('camelCase models', () => {
    it('accept snake_case filter, search and ordering names through the column name', async () => {
      const Camel = sequelize.define(
        'Camel',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true },
          userName: { type: DataTypes.TEXT, field: 'username' },
          createdAt: { type: DataTypes.DATE, field: 'created_at' },
        },
        { tableName: 'users', timestamps: false },
      );
      const f = createFiltering({
        model: Camel,
        filterSet: defineFilterSet({ created_at: ['year'], user_name: { field: 'username', lookups: ['icontains'] } }),
        searchFields: ['username'],
        orderingFields: ['created_at'],
      });
      const rows = await Camel.findAll({
        ...f.apply({ query: '?created_at__year=2025&ordering=created_at' }),
        attributes: ['id'],
      });
      assert.deepEqual(ids(rows), [5]);
      assert.deepEqual(
        sorted(ids(await Camel.findAll({ ...f.apply({ query: '?search=JOHN' }), attributes: ['id'] }))),
        [1, 2, 3, 4, 5],
      );
    });
  });

  describe('many-to-many and paranoid associations', () => {
    let Tag;
    let Project;
    before(async () => {
      Tag = sequelize.define('Tag', { name: DataTypes.TEXT }, { tableName: 'dsf_tags', timestamps: false });
      const UserTag = sequelize.define('UserTag', {}, { tableName: 'dsf_user_tags', timestamps: false });
      Project = sequelize.define(
        'Project',
        { title: DataTypes.TEXT, user_id: DataTypes.INTEGER },
        { tableName: 'dsf_projects', paranoid: true, underscored: true },
      );
      User.belongsToMany(Tag, { through: UserTag, as: 'tags', foreignKey: 'user_id', otherKey: 'tag_id' });
      User.hasMany(Project, { as: 'projects', foreignKey: 'user_id' });
      await sequelize.query('DROP TABLE IF EXISTS dsf_user_tags, dsf_tags, dsf_projects');
      await Tag.sync();
      await UserTag.sync();
      await Project.sync();
      const [red, blue] = await Tag.bulkCreate([{ name: 'red' }, { name: 'blue' }]);
      await UserTag.bulkCreate([
        { user_id: 1, tag_id: red.id },
        { user_id: 1, tag_id: blue.id },
        { user_id: 2, tag_id: blue.id },
      ]);
      const [, gone] = await Project.bulkCreate([
        { title: 'alpha', user_id: 1 },
        { title: 'beta', user_id: 2 },
      ]);
      await gone.destroy(); // soft delete
    });

    it('filters and searches through a belongs-to-many', async () => {
      const f = createFiltering({
        model: User,
        filterSet: defineFilterSet({ tags__name: ['exact', 'in', 'isnull'] }),
        searchFields: ['tags__name'],
      });
      assert.deepEqual(sorted(await find(f, '?tags__name=blue')), [1, 2]);
      assert.deepEqual(
        sorted(await find(f, '?tags__name=red&tags__name=blue')),
        [1, 2],
        'repeated param: last value wins',
      );
      assert.deepEqual(
        await find(f, '?tags__name=red&tags__name__in=blue'),
        [1],
        'two filters, each matched independently',
      );
      assert.deepEqual(sorted(await find(f, '?search=red')), [1]);
      assert.equal((await find(f, '?tags__name__isnull=true')).length, 11);
    });

    it('ignores soft-deleted related rows, like a Sequelize include', async () => {
      const f = createFiltering({ model: User, filterSet: defineFilterSet({ projects__title: ['exact', 'isnull'] }) });
      assert.deepEqual(await find(f, '?projects__title=alpha'), [1]);
      assert.deepEqual(await find(f, '?projects__title=beta'), []);
      assert.ok((await find(f, '?projects__title__isnull=true')).includes(2));
    });
  });

  describe('application on a different copy of Sequelize (npm link, file:, monorepos)', () => {
    const copy = new globalThis.URL('../../node_modules/.dsf-sequelize-copy/', import.meta.url);
    let other;
    after(async () => {
      await other?.close();
      await rm(copy, { recursive: true, force: true });
    });
    it("builds every SQL expression with the model's own Sequelize class", async () => {
      await cp(new globalThis.URL('../../node_modules/sequelize/', import.meta.url), copy, { recursive: true });
      const { Sequelize: OtherSequelize, DataTypes: T } = (await import(new globalThis.URL('lib/index.js', copy)))
        .default;
      assert.notEqual(OtherSequelize, Sequelize);
      other = new OtherSequelize(URL, { logging: false });
      const opts = { timestamps: false };
      const Company = other.define('Company', { name: T.TEXT }, { ...opts, tableName: 'companies' });
      const U = other.define(
        'User',
        { username: T.TEXT, created_at: T.DATE, company_id: T.INTEGER },
        { ...opts, tableName: 'users' },
      );
      U.belongsTo(Company, { as: 'company', foreignKey: 'company_id' });
      const f = createFiltering({
        model: U,
        filterSet: defineFilterSet({ company__name: ['icontains'], created_at: ['year'] }),
        searchFields: ['@company__name'],
        orderingFields: ['company__name', 'id'],
      });
      const rows = async (q) => (await U.findAll({ ...f.apply({ query: q }), attributes: ['id'] })).map((r) => r.id);
      assert.deepEqual(sorted(await rows('?company__name__icontains=google')), [1, 2, 3, 4, 12]);
      assert.deepEqual(sorted(await rows('?search=nokia')), [7, 8]);
      assert.deepEqual(await rows('?created_at__year=2023'), [4]);
      assert.deepEqual((await rows('?ordering=company__name,id')).slice(0, 3), [5, 6, 13]);
    });
  });

  describe('dateFromToRange day boundaries', () => {
    const range = (timeZone) =>
      createFiltering({
        model: User,
        filterSet: defineFilterSet({ created: { type: 'dateFromToRange', field: 'created_at' } }),
        ...(timeZone ? { timeZone } : {}),
      });
    const all2024AndBefore = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13];
    it('rolls the upper bound over the year end (UTC)', async () => {
      const f = range();
      assert.deepEqual(sorted(await find(f, '?created_before=2024-12-31')), all2024AndBefore);
      assert.deepEqual(sorted(await find(f, '?created_before=2024-12-30')), all2024AndBefore);
      assert.deepEqual(await find(f, '?created_before=2023-12-31'), [4]);
      assert.deepEqual(await find(f, '?created_after=2023-12-31&created_before=2023-12-31'), [4]);
      assert.deepEqual(await find(f, '?created_after=2024-12-31'), [5]);
    });
    it('handles leap and non-leap February ends', async () => {
      const f = range();
      assert.deepEqual(await find(f, '?created_after=2024-02-29&created_before=2024-02-29'), [7]);
      assert.deepEqual(sorted(await find(f, '?created_before=2024-02-28')), [1, 4]);
      assert.deepEqual(await find(f, '?created_after=2025-02-28&created_before=2025-02-28'), [5]);
    });
    it('uses whole local days in a DST zone across the year end', async () => {
      // User 1 is 2024-01-01T00:00Z = 2023-12-31 19:00 in New York.
      const f = range('America/New_York');
      assert.deepEqual(sorted(await find(f, '?created_before=2023-12-31')), [1, 4]);
      assert.deepEqual(sorted(await find(f, '?created_after=2023-12-31&created_before=2023-12-31')), [1, 4]);
    });
  });

  describe('queryset and filter-method contracts', () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    before(() => process.on('unhandledRejection', onUnhandled));
    after(() => process.off('unhandledRejection', onUnhandled));
    const settle = () => new Promise((r) => setTimeout(r, 30));

    const restricted = (queryset) =>
      createFiltering({
        model: User,
        filterSet: defineFilterSet({ company: { type: 'modelChoice', queryset } }),
      });

    it('a synchronous queryset keeps restricting rows', async () => {
      const f = restricted(() => ({ id: 1 }));
      assert.deepEqual(await find(f, '?company=4'), []);
      assert.deepEqual(sorted(await find(f, '?company=1')), [1, 2, 12]);
      await assert.rejects(f.applyAsync({ query: '?company=4' }), InvalidValueError);
    });

    it('an async queryset is rejected by apply() and applyAsync(); restricted rows never escape', async () => {
      const f = restricted(async () => ({ id: 1 }));
      assert.throws(() => f.apply({ query: '?company=4' }), ConfigurationError);
      await assert.rejects(f.applyAsync({ query: '?company=4' }), ConfigurationError);
      // No filter param: the queryset is not consulted, so nothing is rejected.
      assert.equal((await find(f, '')).length, 13);
    });

    it('a rejected queryset promise is a ConfigurationError, not an unhandled rejection', async () => {
      const f = restricted(() => Promise.reject(new Error('db down')));
      assert.throws(() => f.apply({ query: '?company=1' }), ConfigurationError);
      await assert.rejects(f.applyAsync({ query: '?company=1' }), ConfigurationError);
      await settle();
      assert.deepEqual(unhandled, []);
    });

    it('a queryset that returns something other than a where object is rejected', () => {
      for (const bad of [() => {}, () => null, () => [{ id: 1 }], () => 'id = 1', () => 1]) {
        assert.throws(() => restricted(bad).apply({ query: '?company=1' }), ConfigurationError, String(bad));
      }
    });

    const permission = (method) =>
      createFiltering({ model: User, filterSet: defineFilterSet({ mine: { type: 'boolean', method } }) });

    it('a method that adds conditions with andWhere works (block or arrow body)', async () => {
      const block = permission(({ value, andWhere }) => {
        if (value) andWhere({ company_id: 1 });
      });
      const arrow = permission(({ andWhere }) => andWhere({ company_id: 1 }));
      assert.deepEqual(sorted(await find(block, '?mine=true')), [1, 2, 12]);
      assert.deepEqual(sorted(await find(arrow, '?mine=true')), [1, 2, 12]);
      assert.deepEqual(sorted(ids(await User.findAll(await arrow.applyAsync({ query: '?mine=true' })))), [1, 2, 12]);
    });

    it('a method that returns its condition fails loudly instead of returning every row', async () => {
      const f = permission(() => ({ company_id: 1 }));
      assert.throws(() => f.apply({ query: '?mine=true' }), ConfigurationError);
      await assert.rejects(f.applyAsync({ query: '?mine=true' }), ConfigurationError);
    });

    it('an async method fails loudly under apply() and applyAsync()', async () => {
      const quick = permission(async ({ andWhere }) => andWhere({ company_id: 1 }));
      const slow = permission(async ({ andWhere }) => {
        await settle();
        andWhere({ company_id: 1 });
      });
      for (const f of [quick, slow]) {
        assert.throws(() => f.apply({ query: '?mine=true' }), ConfigurationError);
        await assert.rejects(f.applyAsync({ query: '?mine=true' }), ConfigurationError);
      }
      await settle();
    });

    it('a rejected method promise is a ConfigurationError, not an unhandled rejection', async () => {
      const f = permission(async () => {
        throw new Error('permission lookup failed');
      });
      assert.throws(() => f.apply({ query: '?mine=true' }), ConfigurationError);
      await assert.rejects(f.applyAsync({ query: '?mine=true' }), ConfigurationError);
      await settle();
      assert.deepEqual(unhandled, []);
    });

    it('an error thrown synchronously by a method propagates unchanged', () => {
      const f = permission(() => {
        throw new RangeError('boom');
      });
      assert.throws(() => f.apply({ query: '?mine=true' }), RangeError);
    });
  });

  describe('search terms are comma-separated', () => {
    let Person;
    before(async () => {
      await sequelize.query(`
        DROP TABLE IF EXISTS dsf_nicknames, dsf_people, dsf_teams;
        CREATE TABLE dsf_teams (id int PRIMARY KEY, name text);
        CREATE TABLE dsf_people (id int PRIMARY KEY, name text, team_id int REFERENCES dsf_teams(id));
        CREATE TABLE dsf_nicknames (id serial PRIMARY KEY, label text, person_id int REFERENCES dsf_people(id));
        INSERT INTO dsf_teams VALUES (1, 'Delhi Kings'), (2, 'Mumbai Stars');
        INSERT INTO dsf_people VALUES
          (1, 'ankur kharb', 1), (2, 'kharb ankur', 2), (3, 'ankur', 1), (4, 'rahul kumar', 2),
          (5, 'kumar rahul', NULL), (6, 'Ankur Sharma', 1), (7, 'rahul', 2);
        INSERT INTO dsf_nicknames (label, person_id) VALUES ('ak 47', 1), ('rk', 4);`);
      const Team = sequelize.define('Team', { name: DataTypes.TEXT }, { tableName: 'dsf_teams', timestamps: false });
      const Nickname = sequelize.define(
        'Nickname',
        { label: DataTypes.TEXT, person_id: DataTypes.INTEGER },
        { tableName: 'dsf_nicknames', timestamps: false },
      );
      Person = sequelize.define(
        'Person',
        { name: DataTypes.TEXT, team_id: DataTypes.INTEGER },
        { tableName: 'dsf_people', timestamps: false },
      );
      Person.belongsTo(Team, { as: 'team', foreignKey: 'team_id' });
      Person.hasMany(Nickname, { as: 'nicknames', foreignKey: 'person_id' });
    });
    const people = async (searchFields, q) => {
      const f = createFiltering({ model: Person, searchFields });
      return sorted(ids(await Person.findAll({ ...f.apply({ query: q }), attributes: ['id'] })));
    };

    it('keeps spaces inside a term: "ankur kharb" is one term, not ankur AND kharb', async () => {
      assert.deepEqual(await people(['name'], '?search=ankur kharb'), [1]); // not [1, 2]
      assert.deepEqual(await people(['name'], '?search=ankur%20kharb'), [1]);
    });
    it('splits on commas: every term must match (AND)', async () => {
      assert.deepEqual(await people(['name'], '?search=ankur'), [1, 2, 3, 6]);
      assert.deepEqual(await people(['name'], '?search=ankur,kharb'), [1, 2]);
      assert.deepEqual(await people(['name'], '?search=a'), [1, 2, 3, 4, 5, 6, 7]);
      assert.deepEqual(await people(['name'], '?search=a,b'), [1, 2]);
      assert.deepEqual(await people(['name'], '?search=a,b,c'), []);
      assert.deepEqual(await people(['name'], '?search=ankur kharb,rahul kumar'), []);
    });
    it('ignores whitespace around commas but keeps it inside a term', async () => {
      assert.deepEqual(await people(['name'], '?search=ankur, kharb'), [1, 2]);
      assert.deepEqual(await people(['name'], '?search=ankur ,kharb'), [1, 2]);
      assert.deepEqual(await people(['name'], '?search=ankur , kharb'), [1, 2]);
      assert.deepEqual(await people(['name'], '?search=  ankur kharb  '), [1]); // still one term
      assert.deepEqual(await people(['name'], '?search=ankur kharb, delhi'), []);
      assert.deepEqual(await people(['name', 'team__name'], '?search=ankur kharb, delhi'), [1]);
      assert.deepEqual(await people(['name'], '?search=rahul kumar, kumar'), [4]);
      assert.deepEqual(await people(['name'], '?search=rahul,,kumar,'), [4, 5]);
      assert.deepEqual(await people(['name'], '?search= , '), [1, 2, 3, 4, 5, 6, 7]); // no search
    });
    it('quotes group a phrase and are removed; unquoted spaces still do not split', async () => {
      assert.deepEqual(await people(['name'], '?search=kharb ankur'), [2]); // one term, like JOHN doe
      assert.deepEqual(await people(['name'], '?search="ankur kharb"'), [1]);
      assert.deepEqual(await people(['name'], "?search='kharb ankur'"), [2]);
      assert.deepEqual(await people(['name', 'team__name'], '?search="ankur kharb", delhi'), [1]);
      assert.deepEqual(await people(['name'], '?search="kumar, rahul"'), []); // comma inside quotes is text
      assert.deepEqual(await people(['name'], '?search=kumar, rahul'), [4, 5]);
      assert.deepEqual(await people(['name'], '?search=%22'), [1, 2, 3, 4, 5, 6, 7]); // lone quote: no search
    });
    it('a single word matches inside a multi-word value (substring search)', async () => {
      assert.deepEqual(await people(['name'], '?search=rahul'), [4, 5, 7]);
      assert.deepEqual(await people(['name'], '?search=RAHUL KUMAR'), [4]);
    });
    it('search-field prefixes apply per field; a prefix character in the value is literal text', async () => {
      assert.deepEqual(await people(['^name'], '?search=ankur kharb'), [1]);
      assert.deepEqual(await people(['^name'], '?search=kharb,ankur'), []);
      assert.deepEqual(await people(['^name'], '?search=kharb'), [2]);
      assert.deepEqual(await people(['=name'], '?search=RAHUL KUMAR'), [4]);
      assert.deepEqual(await people(['name'], '?search=^ankur,^rahul'), []);
      assert.deepEqual(await people(['name'], '?search==ankur,=rahul'), []);
    });
    it('works across relationships (belongs-to and has-many)', async () => {
      const fields = ['name', 'team__name', 'nicknames__label'];
      assert.deepEqual(await people(fields, '?search=delhi kings'), [1, 3, 6]);
      assert.deepEqual(await people(fields, '?search=mumbai,rahul'), [4, 7]);
      assert.deepEqual(await people(fields, '?search=ankur kharb,delhi'), [1]);
      assert.deepEqual(await people(fields, '?search=ak 47'), [1]);
      assert.deepEqual(await people(fields, '?search=kings mumbai'), []);
    });
  });

  describe('configuration', () => {
    it('reports misconfiguration at startup when the model is given', () => {
      assert.throws(() => createFiltering({ model: User, filterFields: ['nope'] }), ConfigurationError);
    });
  });
});
