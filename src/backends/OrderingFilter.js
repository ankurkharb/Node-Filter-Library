/**
 * OrderingFilter — DRF OrderingFilter equivalent.
 *
 * - `?ordering=-created_at,name` (last value of a repeated param).
 * - Terms not in `orderingFields` are silently dropped (DRF
 *   `remove_invalid_fields`), or rejected with `invalidOrderingBehavior: 'error'`.
 * - If no valid term remains, the default ordering applies. The default is set
 *   by the developer and is NOT checked against `orderingFields` (DRF
 *   `get_default_ordering`).
 * - `orderingFields: '__all__'` allows every model attribute.
 * - Related fields (`company__name`) are ordered with a correlated subquery;
 *   only single-valued (belongs-to / has-one) paths are allowed.
 */

import { BaseFilterBackend } from './BaseFilterBackend.js';
import { normalizeQuery, parseOrdering } from '../parser/index.js';
import { ConfigurationError, InvalidOrderingError } from '../errors/index.js';
import { columnOf, getAttribute, isSingleValued, resolveAssociationPath } from '../sequelize/model.js';
import { orderingExpression } from '../sequelize/relations.js';

const NO_MODEL = {};
/** @type {WeakMap<object, Map<string, object>>} */
const compiledCache = new WeakMap();

/**
 * Resolve one ordering field name against the model.
 * @param {string} name
 * @param {object|null} model
 */
export function compileOrderingField(name, model) {
  if (typeof name !== 'string' || name === '' || name.startsWith('-')) {
    throw new ConfigurationError(`Invalid ordering field ${JSON.stringify(name)}`);
  }
  const segments = name.split('__');
  if (!model) {
    return { name, associations: [], attribute: name, column: name, requiresModel: segments.length > 1 };
  }
  const where = `Ordering field "${name}"`;
  const { associations, target } = resolveAssociationPath(model, segments.slice(0, -1), where);
  const bad = associations.find((a) => !isSingleValued(a));
  if (bad) {
    throw new ConfigurationError(`${where}: cannot order by a to-many relation ("${bad.as}")`);
  }
  const attr = getAttribute(target, segments[segments.length - 1]);
  if (!attr) {
    throw new ConfigurationError(`${where}: ${target.name} has no attribute "${segments[segments.length - 1]}"`);
  }
  return { name, associations, attribute: attr.name, column: columnOf(target, attr.name), requiresModel: false };
}

export class OrderingFilter extends BaseFilterBackend {
  /**
   * @param {{ orderingParam?: string }} [options]
   */
  constructor(options = {}) {
    super();
    this.orderingParam = options.orderingParam;
  }

  /**
   * Allowed client ordering fields: `Map<name, compiled>`.
   * @param {object} context
   */
  getValidFields(context) {
    const { model, config } = context;
    const key = model || NO_MODEL;
    let perModel = compiledCache.get(key);
    if (!perModel) {
      perModel = new Map();
      compiledCache.set(key, perModel);
    }
    const cacheKey = JSON.stringify(config.orderingFields);
    let valid = perModel.get(cacheKey);
    if (!valid) {
      valid = new Map();
      if (config.orderingFields === '__all__') {
        if (!model) throw new ConfigurationError('orderingFields "__all__" requires a Sequelize model');
        const attrs = typeof model.getAttributes === 'function' ? model.getAttributes() : model.rawAttributes;
        for (const [attrName, def] of Object.entries(attrs)) {
          const compiled = compileOrderingField(attrName, model);
          valid.set(attrName, compiled);
          if (def.field && def.field !== attrName) valid.set(def.field, compiled);
        }
      } else {
        for (const name of config.orderingFields) valid.set(name, compileOrderingField(name, model || null));
      }
      perModel.set(cacheKey, valid);
    }
    return valid;
  }

  /** DRF `get_default_ordering(view)`. */
  getDefaultOrdering(context) {
    return context.config.defaultOrdering.map(({ field, direction }) => ({
      compiled: compileOrderingField(field, context.model || null),
      direction,
    }));
  }

  /** DRF `get_ordering(request, queryset, view)`. */
  getOrdering(context) {
    const param = this.orderingParam || context.config.orderingParam;
    const terms = parseOrdering(normalizeQuery(context.query)[param]);
    if (terms.length > 0) {
      const valid = this.getValidFields(context);
      const ordering = [];
      for (const { term, field, direction } of terms) {
        const compiled = valid.get(field);
        if (compiled) {
          ordering.push({ compiled, direction });
        } else if (context.config.invalidOrderingBehavior === 'error') {
          throw new InvalidOrderingError(`Invalid ordering field: ${term}`, { field: param, value: term });
        }
      }
      if (ordering.length > 0) return ordering;
    }
    return this.getDefaultOrdering(context);
  }

  apply(context) {
    const { queryState, model } = context;
    const ordering = this.getOrdering(context);
    if (ordering.length === 0) return queryState;
    queryState.order = ordering.map(({ compiled, direction }) => {
      if (compiled.associations.length === 0) {
        if (compiled.requiresModel) {
          throw new ConfigurationError(
            `Ordering field "${compiled.name}" follows a relationship, which requires a Sequelize model`,
          );
        }
        return [compiled.attribute, direction];
      }
      return [orderingExpression(model, compiled.associations, compiled.column, context.aliases), direction];
    });
    return queryState;
  }
}

export default OrderingFilter;
