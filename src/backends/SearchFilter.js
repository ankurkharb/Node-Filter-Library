/**
 * SearchFilter — DRF SearchFilter equivalent.
 *
 * `?search=` (last value of a repeated param) is split on commas only
 * (`splitSearchTerms`); spaces stay inside a term. Each term must match at least one search field
 * (OR across fields); every term must match (AND across terms).
 *
 * Search field syntax, as DRF: `^name` istartswith, `=name` iexact,
 * `$name` iregex, `@name` full-text, `name__<lookup>` explicit lookup,
 * `name` icontains. Relationship paths (`company__name`) are supported.
 */

import { Op } from 'sequelize';
import { BaseFilterBackend } from './BaseFilterBackend.js';
import { lastValue, normalizeQuery, splitSearchTerms } from '../parser/index.js';
import { SEARCH_PREFIXES, TEXT_LOOKUPS, buildCondition, parseLookup } from '../lookups/index.js';
import { andWhere } from '../core/queryState.js';
import { ConfigurationError, InvalidSearchError, SecurityLimitError } from '../errors/index.js';
import { columnOf, getAssociation, getAttribute, inferFilterType, isTextColumn } from '../sequelize/model.js';
import { relationCondition } from '../sequelize/relations.js';
import { sqlFor } from '../sequelize/sql.js';

/** Lookups allowed as an explicit suffix on a search field. */
const SEARCH_LOOKUPS = new Set(['exact', ...TEXT_LOOKUPS]);

const NO_MODEL = {};
/** @type {WeakMap<object, Map<string, object[]>>} */
const compiledCache = new WeakMap();

/**
 * Parse and validate one `search_fields` entry.
 * @param {string} entry
 * @param {object|null} model
 */
export function compileSearchField(entry, model) {
  if (typeof entry !== 'string' || entry.length === 0) {
    throw new ConfigurationError(`Invalid search field ${JSON.stringify(entry)}`);
  }
  let lookup = 'icontains';
  let name = entry;
  const prefixed = Object.prototype.hasOwnProperty.call(SEARCH_PREFIXES, entry[0]);
  if (prefixed) {
    lookup = SEARCH_PREFIXES[entry[0]];
    name = entry.slice(1);
  }
  const segments = name.split('__');
  const where = `Search field "${entry}"`;

  if (!model) {
    if (!prefixed && segments.length > 1 && SEARCH_LOOKUPS.has(segments[segments.length - 1])) {
      lookup = segments.pop();
    }
    return {
      entry,
      parsed: parseLookup(lookup),
      associations: [],
      attribute: segments[segments.length - 1],
      column: segments[segments.length - 1],
      textColumn: true,
      columnType: 'string',
      requiresModel: segments.length > 1,
    };
  }

  const associations = [];
  let target = model;
  let attr = null;
  segments.forEach((segment, i) => {
    if (attr === null) {
      const assoc = getAssociation(target, segment);
      if (assoc) {
        associations.push(assoc);
        target = assoc.target;
        return;
      }
      attr = getAttribute(target, segment);
      if (attr) return;
      throw new ConfigurationError(`${where}: ${target.name} has no attribute or association "${segment}"`);
    }
    if (!prefixed && i === segments.length - 1 && SEARCH_LOOKUPS.has(segment)) {
      lookup = segment;
      return;
    }
    throw new ConfigurationError(`${where}: "${segment}" is not a supported search lookup`);
  });
  if (attr === null) throw new ConfigurationError(`${where}: must end with an attribute, not an association`);

  return {
    entry,
    parsed: parseLookup(lookup),
    associations,
    attribute: attr.name,
    column: columnOf(target, attr.name),
    textColumn: isTextColumn(attr.def),
    columnType: inferFilterType(attr.def).type,
    requiresModel: false,
  };
}

export class SearchFilter extends BaseFilterBackend {
  /**
   * @param {{ searchParam?: string }} [options]
   */
  constructor(options = {}) {
    super();
    this.searchParam = options.searchParam;
  }

  /** DRF `get_search_fields(view, request)`. */
  getSearchFields(context) {
    if (typeof context.config.getSearchFields === 'function') return context.config.getSearchFields(context) || [];
    return context.config.searchFields || [];
  }

  /** DRF `get_search_terms(request)`. */
  getSearchTerms(context) {
    const param = this.searchParam || context.config.searchParam;
    const value = lastValue(normalizeQuery(context.query)[param]) ?? '';
    if (value.includes('\0')) {
      // DRF runs the value through a CharField, which rejects null characters.
      throw new InvalidSearchError('Null characters are not allowed.', { field: param });
    }
    return splitSearchTerms(value);
  }

  compile(fields, model) {
    const key = model || NO_MODEL;
    let perModel = compiledCache.get(key);
    if (!perModel) {
      perModel = new Map();
      compiledCache.set(key, perModel);
    }
    const cacheKey = JSON.stringify(fields);
    let compiled = perModel.get(cacheKey);
    if (!compiled) {
      compiled = fields.map((f) => compileSearchField(f, model || null));
      perModel.set(cacheKey, compiled);
    }
    return compiled;
  }

  apply(context) {
    const { queryState, model, security } = context;
    const fields = this.getSearchFields(context);
    const terms = this.getSearchTerms(context);
    if (!fields || fields.length === 0 || terms.length === 0) return queryState;

    if (terms.length > security.maxSearchTerms) {
      throw new SecurityLimitError(`Too many search terms (max ${security.maxSearchTerms})`, {
        details: { maxSearchTerms: security.maxSearchTerms },
      });
    }

    const compiled = this.compile(fields, model);
    for (const term of terms) {
      const conditions = compiled.map((field) => this.fieldCondition(field, term, context));
      andWhere(queryState, conditions.length === 1 ? conditions[0] : { [Op.or]: conditions });
    }
    return queryState;
  }

  fieldCondition(field, term, context) {
    const { model } = context;
    if (field.requiresModel && !model) {
      throw new ConfigurationError(
        `Search field "${field.entry}" follows a relationship, which requires a Sequelize model`,
      );
    }
    const sql = sqlFor(model);
    const options = {
      sql,
      regexMaxLength: context.security.regexMaxLength,
      searchConfig: context.config.searchConfig,
      meta: { field: field.entry },
    };
    const leaf = (alias, key) =>
      buildCondition(
        {
          key,
          ref: sql.col(alias ? `${alias}.${field.column}` : field.column),
          type: field.columnType,
          // Search terms are text: compare non-text columns as text, as Django does.
          castText: !field.textColumn,
        },
        field.parsed,
        term,
        options,
      );
    if (field.associations.length === 0) return leaf(model?.name, field.attribute);
    return relationCondition(field.associations, (m, alias) => leaf(alias, field.column), {
      aliases: context.aliases,
    });
  }
}

export default SearchFilter;
