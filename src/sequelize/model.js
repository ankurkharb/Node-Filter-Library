/**
 * Sequelize model introspection: attributes, associations, filter-type
 * inference. Everything here reads public model metadata.
 */

import { ConfigurationError } from '../errors/index.js';

/** @param {object} model */
function attributesOf(model) {
  if (!model) return null;
  return typeof model.getAttributes === 'function' ? model.getAttributes() : model.rawAttributes || null;
}

/**
 * Find an attribute by name, or by column name (so a snake_case param works
 * against a camelCase attribute whose `field` is snake_case).
 * @param {object} model
 * @param {string} name
 * @returns {{ name: string, def: object } | null}
 */
export function getAttribute(model, name) {
  const attrs = attributesOf(model);
  if (!attrs) return null;
  if (Object.prototype.hasOwnProperty.call(attrs, name)) return { name, def: attrs[name] };
  for (const [attrName, def] of Object.entries(attrs)) {
    if (def && def.field === name) return { name: attrName, def };
  }
  return null;
}

/**
 * Column name of an attribute (falls back to the name itself).
 * @param {object} model
 * @param {string} attrName
 */
export function columnOf(model, attrName) {
  return attributesOf(model)?.[attrName]?.field ?? attrName;
}

/**
 * @param {object} model
 * @param {string} name association alias (`as`)
 */
export function getAssociation(model, name) {
  const assocs = model?.associations;
  if (!assocs) return null;
  if (Object.prototype.hasOwnProperty.call(assocs, name)) return assocs[name];
  return Object.values(assocs).find((a) => a.as === name) || null;
}

/** @param {object} association */
export function isSingleValued(association) {
  return association.associationType === 'BelongsTo' || association.associationType === 'HasOne';
}

/**
 * Walk an association path.
 * @param {object} model
 * @param {string[]} segments
 * @param {string} context used in error messages
 * @returns {{ associations: object[], target: object }}
 */
export function resolveAssociationPath(model, segments, context) {
  const associations = [];
  let target = model;
  for (const segment of segments) {
    const assoc = getAssociation(target, segment);
    if (!assoc) {
      throw new ConfigurationError(`${context}: "${segment}" is not an association of ${target.name}`);
    }
    associations.push(assoc);
    target = assoc.target;
  }
  return { associations, target };
}

const TYPE_MAP = {
  INTEGER: 'integer',
  BIGINT: 'integer',
  SMALLINT: 'integer',
  MEDIUMINT: 'integer',
  TINYINT: 'integer',
  FLOAT: 'float',
  DOUBLE: 'float',
  'DOUBLE PRECISION': 'float',
  REAL: 'float',
  DECIMAL: 'decimal',
  NUMERIC: 'decimal',
  BOOLEAN: 'boolean',
  UUID: 'uuid',
  DATEONLY: 'date',
  DATE: 'datetime',
  TIME: 'time',
  ENUM: 'choice',
};

const TEXT_TYPES = new Set(['STRING', 'TEXT', 'CHAR', 'CITEXT']);

/** @param {object} attrDef */
function typeKey(attrDef) {
  const t = attrDef?.type;
  return t?.key ?? t?.constructor?.key ?? null;
}

/**
 * django-filter's FILTER_FOR_DBFIELD_DEFAULTS, for Sequelize types.
 * @param {object} attrDef
 * @returns {{ type: string, choices?: string[] }}
 */
export function inferFilterType(attrDef) {
  const key = typeKey(attrDef);
  const type = TYPE_MAP[key] ?? 'string';
  if (type === 'choice') {
    const values = attrDef.values ?? attrDef.type?.values ?? [];
    return { type, choices: values.map(String) };
  }
  return { type };
}

/**
 * Whether text lookups can be applied without a cast.
 * @param {object|null} attrDef
 * @param {string} fallbackType used when the model is unknown
 */
export function isTextColumn(attrDef, fallbackType) {
  const key = typeKey(attrDef);
  if (key) return TEXT_TYPES.has(key);
  return fallbackType === 'string' || fallbackType === 'char' || fallbackType === 'choice';
}

/**
 * Sequelize's paranoid clause for a model, as a where fragment keyed by column.
 * @param {object} model
 */
export function paranoidClause(model) {
  if (!model?.options?.paranoid) return null;
  const attr = model._timestampAttributes?.deletedAt;
  if (!attr) return null;
  const def = attributesOf(model)[attr];
  return { [def?.field ?? attr]: def?.defaultValue ?? null };
}
