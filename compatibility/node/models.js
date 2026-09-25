import { DataTypes } from 'sequelize';

/** Sequelize models over the tables created by ../seed.sql. */
export function defineModels(sequelize) {
  const options = (tableName) => ({ tableName, timestamps: false, underscored: true });

  const Company = sequelize.define(
    'Company',
    { id: { type: DataTypes.INTEGER, primaryKey: true }, name: DataTypes.TEXT, country: DataTypes.TEXT },
    options('companies'),
  );
  const Department = sequelize.define(
    'Department',
    { id: { type: DataTypes.INTEGER, primaryKey: true }, name: DataTypes.TEXT, company_id: DataTypes.INTEGER },
    options('departments'),
  );
  const User = sequelize.define(
    'User',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      username: DataTypes.TEXT,
      email: DataTypes.TEXT,
      age: DataTypes.INTEGER,
      score: DataTypes.DOUBLE,
      status: DataTypes.TEXT,
      is_active: DataTypes.BOOLEAN,
      password_hash: DataTypes.TEXT,
      uid: DataTypes.UUID,
      deleted_at: DataTypes.DATE,
      created_at: DataTypes.DATE,
      company_id: DataTypes.INTEGER,
    },
    options('users'),
  );
  const Order = sequelize.define(
    'Order',
    { id: { type: DataTypes.INTEGER, primaryKey: true }, code: DataTypes.TEXT, user_id: DataTypes.INTEGER },
    options('orders'),
  );

  Company.hasMany(Department, { foreignKey: 'company_id', as: 'departments' });
  Department.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });
  Company.hasMany(User, { foreignKey: 'company_id', as: 'users' });
  User.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });
  User.hasMany(Order, { foreignKey: 'user_id', as: 'orders' });
  Order.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  return { Company, Department, User, Order };
}
