/**
 * Translate a bound filter + lookup + coerced value into a Sequelize where
 * fragment, directly on the root model or through a relationship subquery.
 */

import { Op } from 'sequelize';
import { ConfigurationError } from '../errors/index.js';
import { TEXT_LOOKUPS, buildCondition } from '../lookups/index.js';
import { columnOf, getAttribute, isTextColumn } from './model.js';
import { collapseForeignKeys, relationCondition, rootJoinColumn } from './relations.js';
import { sqlFor } from './sql.js';

/**
 * @typedef {{ parsed: import('../lookups/index.js').ParsedLookup, value: unknown }} FilterPart
 */

/**
 * Throw a ConfigurationError if a user callback returned a promise. Callbacks
 * run synchronously inside the query build; an ignored promise would silently
 * drop whatever it was meant to add. The promise's own rejection is observed so
 * it cannot also surface as an unhandled rejection.
 * @param {unknown} value
 * @param {string} message
 */
export function rejectThenable(value, message) {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof value.then === 'function'
  ) {
    Promise.resolve(value).catch(() => {});
    throw new ConfigurationError(message);
  }
}

/**
 * Evaluate a model-choice `queryset` restriction. It must synchronously return
 * a where object: anything else would silently remove the restriction.
 * @param {object} filter bound filter
 * @param {object} context filtering context
 */
export function evaluateQueryset(filter, context) {
  const where = filter.def.queryset(context);
  rejectThenable(
    where,
    `Filter "${filter.key}": "queryset" must be synchronous and return a where object; it returned a promise`,
  );
  if (where === null || typeof where !== 'object' || Array.isArray(where)) {
    throw new ConfigurationError(
      `Filter "${filter.key}": "queryset" must return a where object, got ${where === null ? 'null' : Array.isArray(where) ? 'an array' : typeof where}`,
    );
  }
  return where;
}

/**
 * @param {object} filter bound filter (see core/bind.js)
 * @param {FilterPart[]} parts conditions evaluated against the same row
 * @param {object} context filtering context
 * @param {{ combine?: 'and'|'or' }} [options]
 */
export function filterCondition(filter, parts, context, options = {}) {
  const { model } = context;
  if (filter.def.path && !model) {
    throw new ConfigurationError(`Filter "${filter.key}" follows a relationship, which requires a Sequelize model`);
  }

  const targetWhere = filter.def.queryset ? evaluateQueryset(filter, context) : undefined;
  const { associations, attribute } = targetWhere
    ? { associations: filter.associations, attribute: filter.attribute }
    : collapseForeignKeys(filter.associations, filter.attribute);

  const sql = sqlFor(model);
  const buildOptions = {
    sql,
    regexMaxLength: context.security.regexMaxLength,
    timeZone: context.timeZone,
    meta: { field: filter.key },
  };
  const combine = options.combine === 'or' ? Op.or : Op.and;

  const leaf = (leafModel, alias, isRoot) => {
    const column = leafModel ? columnOf(leafModel, attribute) : attribute;
    const castText = leafModel
      ? !isTextColumn(getAttribute(leafModel, attribute)?.def, filter.valueType)
      : !filter.textColumn;
    const ref = sql.col(alias ? `${alias}.${column}` : column);
    // At the root, key by attribute so Sequelize maps and types it; in a
    // subquery there is no mapping, so key by column.
    const key = isRoot ? attribute : column;
    const conds = parts.map(({ parsed, value }) =>
      buildCondition(
        { key, ref, type: filter.columnType, castText: castText && TEXT_LOOKUPS.has(parsed.op) },
        parsed,
        value,
        buildOptions,
      ),
    );
    return conds.length === 1 ? conds[0] : { [combine]: conds };
  };

  const isNullTrue =
    parts.length === 1 && parts[0].parsed.op === 'isnull' && !parts[0].parsed.transform && parts[0].value === true;

  let condition;
  let guard = null;
  if (associations.length === 0) {
    condition = leaf(model, model?.name, true);
    if (filter.nullable && !parts.some((p) => p.parsed.op === 'isnull')) guard = attribute;
  } else {
    condition = relationCondition(associations, (m, alias) => leaf(m, alias, false), {
      aliases: context.aliases,
      nullMatches: isNullTrue,
      targetWhere,
    });
    const join = rootJoinColumn(associations[0]);
    if (join.nullable && !isNullTrue) guard = join.column;
  }

  if (!filter.def.exclude) return condition;
  // Django's exclude() also keeps rows where the column is NULL:
  // NOT (cond AND col IS NOT NULL).
  const inner = guard ? [condition, { [guard]: { [Op.not]: null } }] : [condition];
  return { [Op.not]: { [Op.and]: inner } };
}
