import { createFiltering, FilteringError } from '../../src/index.js';
import { UserFilterSet } from './filterset.js';

/**
 * Run every case through the library and return results keyed by case id.
 * @param {{ User: object }} models
 * @param {object} views views.json
 * @param {object[]} cases cases.json
 * @param {string} timeZone
 */
export async function runNode({ User }, views, cases, timeZone) {
  const filterings = {};
  for (const [name, spec] of Object.entries(views)) {
    filterings[name] = createFiltering({
      model: User,
      filterSet: UserFilterSet,
      searchFields: spec.search_fields ?? [],
      orderingFields: spec.ordering_fields ?? [],
      ...(spec.ordering ? { defaultOrdering: spec.ordering } : {}),
      timeZone,
    });
  }

  const results = {};
  for (const c of cases) {
    try {
      const options = await filterings[c.view].applyAsync({ query: c.query, model: User });
      const rows = await User.findAll({ ...options, attributes: ['id'], raw: true });
      results[c.id] = { status: 200, ids: rows.map((r) => r.id) };
    } catch (err) {
      if (err instanceof FilteringError) {
        const nested = err.details?.errors;
        const fields = nested ? nested.map((e) => e.field) : err.field ? [err.field] : [];
        results[c.id] = { status: err.status, errorFields: [...new Set(fields)].sort(), error: err.toJSON() };
      } else {
        results[c.id] = { status: 500, error: `${err.name}: ${err.message.split('\n')[0]}` };
      }
    }
  }
  return results;
}
