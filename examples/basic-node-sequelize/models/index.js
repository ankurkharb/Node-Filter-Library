import { Sequelize, DataTypes } from 'sequelize';

const databaseUrl =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/drf_sequelize_filter_example';

export const sequelize = new Sequelize(databaseUrl, {
  logging: false,
  dialect: 'postgres',
});

export const Company = sequelize.define(
  'Company',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    country: { type: DataTypes.STRING },
    department_id: { type: DataTypes.INTEGER, allowNull: true },
  },
  { tableName: 'companies', underscored: true },
);

export const Department = sequelize.define(
  'Department',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    company_id: { type: DataTypes.INTEGER },
  },
  { tableName: 'departments', underscored: true },
);

export const User = sequelize.define(
  'User',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING },
    age: { type: DataTypes.INTEGER },
    status: { type: DataTypes.STRING, defaultValue: 'active' },
    password_hash: { type: DataTypes.STRING },
    deleted_at: { type: DataTypes.DATE, allowNull: true },
    tenant_id: { type: DataTypes.STRING },
    company_id: { type: DataTypes.INTEGER },
  },
  { tableName: 'users', underscored: true },
);

export const Product = sequelize.define(
  'Product',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING },
    price: { type: DataTypes.DECIMAL(10, 2) },
    in_stock: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  { tableName: 'products', underscored: true },
);

export const Order = sequelize.define(
  'Order',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    total: { type: DataTypes.DECIMAL(10, 2) },
    user_id: { type: DataTypes.INTEGER },
  },
  { tableName: 'orders', underscored: true },
);

Company.hasMany(Department, { foreignKey: 'company_id', as: 'departments' });
Department.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

Company.hasMany(User, { foreignKey: 'company_id', as: 'users' });
User.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

Company.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });

User.hasMany(Order, { foreignKey: 'user_id', as: 'orders' });
Order.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
