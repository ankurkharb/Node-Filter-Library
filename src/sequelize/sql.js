import { Sequelize as Bundled } from 'sequelize';

/**
 * The Sequelize class that `model` belongs to.
 *
 * `literal`, `fn`, `col`, `cast` and `where` objects are only recognized by
 * the Sequelize copy that created them. When the application's Sequelize is a
 * different copy from the one this package resolves (npm link, `file:`
 * dependencies, monorepos, version skew), building them with our own import
 * produces broken SQL — so always build them with the model's class.
 * (`Op` symbols are global `Symbol.for` values and are safe to share.)
 *
 * @param {object} [model]
 * @returns {typeof Bundled}
 */
export function sqlFor(model) {
  return model?.sequelize?.constructor ?? Bundled;
}
