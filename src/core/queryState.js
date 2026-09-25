import { Op } from 'sequelize';

/**
 * Mutable Sequelize query state passed through the backend chain.
 *
 * `initial` lets the caller seed the state — e.g. its own `include` for the
 * data it wants to load, or a base `where` — so the filtering output can be
 * passed to `findAll` without overwriting the caller's options.
 *
 * @param {{ where?: object, include?: any[], order?: any[], attributes?: any }} [initial]
 */
export function createQueryState(initial = {}) {
  return {
    where: initial.where ? { ...initial.where } : {},
    include: initial.include ? [...initial.include] : [],
    order: initial.order ? [...initial.order] : [],
    attributes: initial.attributes,
  };
}

/**
 * True when a where object has any string or Symbol (Op.*) keys.
 * @param {object} where
 */
export function hasWhereConditions(where) {
  if (!where || typeof where !== 'object') return false;
  return Reflect.ownKeys(where).length > 0;
}

/**
 * Copy of a query state, for backends that prefer not to mutate.
 * @param {ReturnType<typeof createQueryState>} state
 */
export function cloneQueryState(state) {
  return {
    where: { ...state.where },
    include: state.include.map(cloneInclude),
    order: [...state.order],
    attributes: state.attributes,
  };
}

function cloneInclude(inc) {
  if (typeof inc !== 'object' || inc === null) return inc;
  return {
    ...inc,
    where: inc.where ? { ...inc.where } : undefined,
    include: inc.include ? inc.include.map(cloneInclude) : undefined,
  };
}

/**
 * AND a condition into the root where clause, preserving everything already
 * there. Custom filters and backends should always use this rather than
 * assigning `queryState.where`.
 * @param {ReturnType<typeof createQueryState>} state
 * @param {object} condition
 */
export function andWhere(state, condition) {
  if (condition == null) return state;
  if (!hasWhereConditions(state.where)) {
    state.where = condition;
    return state;
  }
  const existing = state.where;
  if (Reflect.ownKeys(existing).length === 1 && Array.isArray(existing[Op.and])) {
    state.where = { [Op.and]: [...existing[Op.and], condition] };
  } else {
    state.where = { [Op.and]: [existing, condition] };
  }
  return state;
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function conjuncts(where) {
  if (!hasWhereConditions(where)) return [];
  const keys = Reflect.ownKeys(where);
  if (keys.length === 1 && keys[0] === Op.and && Array.isArray(where[Op.and])) return where[Op.and];
  return [where];
}

/**
 * Whether `next` still contains every condition of `prev` — i.e. a custom
 * filter only added conditions (via `andWhere` or by spreading the old where
 * object) and did not replace or overwrite any.
 * @param {object} prev
 * @param {object} next
 */
export function preservesConditions(prev, next) {
  if (prev === next || !hasWhereConditions(prev)) return true;
  if (isPlainObject(prev) && isPlainObject(next) && Reflect.ownKeys(prev).every((k) => next[k] === prev[k])) {
    return true;
  }
  const after = conjuncts(next);
  return conjuncts(prev).every(
    (c) =>
      after.includes(c) ||
      (isPlainObject(c) && after.some((a) => isPlainObject(a) && Reflect.ownKeys(c).every((k) => a[k] === c[k]))),
  );
}

/**
 * Merge or create a nested include path — a helper for custom backends that
 * want to load or constrain associated rows. The built-in backends do not use
 * includes (see ARCHITECTURE.md).
 * @param {ReturnType<typeof createQueryState>} state
 * @param {string[]} associationPath association aliases
 * @param {object|null} leafWhere
 * @param {object} model root Sequelize model
 * @param {{ required?: boolean }} [options]
 */
export function mergeIncludePath(state, associationPath, leafWhere, model, options = {}) {
  if (!associationPath || associationPath.length === 0) return andWhere(state, leafWhere);

  const required = options.required !== false;
  let includes = state.include;
  let current = model;

  associationPath.forEach((as, i) => {
    const association =
      current?.associations?.[as] ?? Object.values(current?.associations ?? {}).find((a) => a.as === as) ?? null;
    const index = includes.findIndex(
      (inc) => inc === as || inc?.as === as || inc?.association === as || inc?.association?.as === as,
    );
    let entry;
    if (index === -1) {
      entry = { association: association ?? as, as, required, include: [] };
      includes.push(entry);
    } else {
      entry = typeof includes[index] === 'string' ? { association: association ?? as, as } : includes[index];
      includes[index] = entry;
      if (required) entry.required = true;
    }
    if (i === associationPath.length - 1 && leafWhere) {
      entry.where = entry.where ? { [Op.and]: [entry.where, leafWhere] } : leafWhere;
    }
    entry.include = entry.include ?? [];
    includes = entry.include;
    current = association?.target;
  });
  return state;
}

/**
 * Convert state to a plain object safe to spread into `Model.findAll()`.
 * @param {ReturnType<typeof createQueryState>} state
 */
export function toSequelizeOptions(state) {
  /** @type {Record<string, unknown>} */
  const opts = {};
  if (hasWhereConditions(state.where)) opts.where = state.where;
  if (state.include && state.include.length > 0) opts.include = state.include;
  if (state.order && state.order.length > 0) opts.order = state.order;
  if (state.attributes !== undefined) opts.attributes = state.attributes;
  return opts;
}
