import { Sequelize } from 'sequelize';
import { defineModels } from '../compatibility/node/models.js';

/**
 * Real Sequelize models on an instance that never connects: enough for
 * association metadata and SQL generation in unit tests.
 */
export function offlineModels(options = {}) {
  const sequelize = new Sequelize('postgres://user:pass@127.0.0.1:1/offline', { logging: false, ...options });
  return { sequelize, ...defineModels(sequelize) };
}

/** The SELECT Sequelize would run for `options` (no database needed). */
export function selectSql(model, options) {
  return model.sequelize
    .getQueryInterface()
    .queryGenerator.selectQuery(model.getTableName(), { ...options, attributes: ['id'] }, model);
}
