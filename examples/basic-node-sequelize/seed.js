import 'dotenv/config';
import { sequelize, Company, Department, User, Product, Order } from './models/index.js';

async function seed() {
  await sequelize.sync({ force: true });

  const eng = await Department.create({ name: 'Engineering' });
  const sales = await Department.create({ name: 'Sales' });

  const google = await Company.create({
    name: 'Google',
    country: 'US',
    department_id: eng.id,
  });
  const acme = await Company.create({
    name: 'Acme Corp',
    country: 'IN',
    department_id: sales.id,
  });

  await User.bulkCreate([
    {
      username: 'john',
      email: 'john@example.com',
      age: 25,
      status: 'active',
      password_hash: 'SECRET',
      company_id: google.id,
      tenant_id: 't1',
    },
    {
      username: 'Johnny',
      email: 'johnny@example.com',
      age: 17,
      status: 'pending',
      password_hash: 'SECRET',
      company_id: google.id,
      tenant_id: 't1',
    },
    {
      username: 'alice',
      email: 'alice@acme.com',
      age: 30,
      status: 'active',
      password_hash: 'SECRET',
      company_id: acme.id,
      tenant_id: 't1',
    },
    {
      username: 'bob',
      email: 'bob@acme.com',
      age: 40,
      status: 'inactive',
      password_hash: 'SECRET',
      company_id: acme.id,
      deleted_at: new Date(),
      tenant_id: 't2',
    },
  ]);

  await Product.bulkCreate([
    { name: 'Widget', price: 9.99, in_stock: true },
    { name: 'Gadget', price: 19.5, in_stock: false },
  ]);

  const users = await User.findAll();
  await Order.create({ user_id: users[0].id, total: 100 });
  await Order.create({ user_id: users[2].id, total: 250 });

  console.log('Seed complete.');
  await sequelize.close();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
