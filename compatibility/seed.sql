-- Shared dataset for the DRF ↔ Node compatibility suite.
-- Deliberately awkward: mixed case, NULLs, empty strings, zero, negatives,
-- LIKE metacharacters, quotes, backslashes, Unicode, and timestamps near
-- midnight so time-zone handling is visible.

DROP TABLE IF EXISTS orders, users, departments, companies CASCADE;

CREATE TABLE companies (id serial PRIMARY KEY, name text, country text);
CREATE TABLE departments (id serial PRIMARY KEY, name text, company_id int REFERENCES companies(id));
CREATE TABLE users (
  id serial PRIMARY KEY,
  username text,
  email text,
  age int,
  score double precision,
  status text,
  is_active boolean,
  password_hash text,
  uid uuid,
  deleted_at timestamptz,
  created_at timestamptz,
  company_id int REFERENCES companies(id)
);
CREATE TABLE orders (id serial PRIMARY KEY, code text, user_id int REFERENCES users(id));

INSERT INTO companies (id, name, country) VALUES
  (1, 'Google', 'US'),
  (2, 'google inc', 'US'),
  (3, 'Acme %Corp', 'DE'),
  (4, 'Nokia', 'FI'),
  (5, 'Zürich AG', 'CH'),
  (6, 'Globex', NULL);
SELECT setval('companies_id_seq', 6);

INSERT INTO departments (id, name, company_id) VALUES
  (1, 'Engineering', 1),
  (2, 'Sales', 1),
  (3, 'engineering', 2),
  (4, 'Legal', 3),
  (5, 'Engineering', 4),
  (6, NULL, 6);
SELECT setval('departments_id_seq', 6);

INSERT INTO users (id, username, email, age, score, status, is_active, password_hash, uid, deleted_at, created_at, company_id) VALUES
  (1,  'john',         'john@example.com',  18,  1.5,   'active',   true,  'h1',  '11111111-1111-4111-8111-111111111111', NULL,                   '2024-01-01T00:00:00Z', 1),
  (2,  'John',         'John@Example.com',  25,  2.0,   'pending',  true,  'h2',  '22222222-2222-4222-8222-222222222222', NULL,                   '2024-03-15T23:30:00Z', 1),
  (3,  'JOHN',         'JOHN@EXAMPLE.COM',  30,  0,     'inactive', false, 'h3',  '33333333-3333-4333-8333-333333333333', '2024-06-01T00:00:00Z', '2024-06-01T12:00:00Z', 2),
  (4,  'john doe',     'jd@example.com',    0,   -3.25, 'active',   true,  'h4',  '44444444-4444-4444-8444-444444444444', NULL,                   '2023-12-31T18:00:00Z', 2),
  (5,  'johnny',       NULL,                -5,  NULL,  'active',   NULL,  'h5',  '01890a5d-ac96-774b-bcce-b302099a8057', NULL,                   '2025-02-28T00:00:00Z', 3),
  (6,  '',             'empty@example.com', NULL, 10,   'pending',  false, 'h6',  NULL,                                   '2025-01-01T00:00:00Z', '2024-07-04T00:00:00Z', 3),
  (7,  '100%off',      'pct@example.com',   40,  5,     'active',   true,  'h7',  NULL,                                   NULL,                   '2024-02-29T00:00:00Z', 4),
  (8,  'under_score',  'us@example.com',    41,  6,     'active',   true,  'h8',  NULL,                                   NULL,                   '2024-08-08T00:00:00Z', 4),
  (9,  'Zoë',          'zoe@example.com',   22,  7,     'active',   true,  'h9',  NULL,                                   NULL,                   '2024-09-09T00:00:00Z', 5),
  (10, 'o''brien',     'ob@example.com',    33,  8,     'inactive', true,  'h10', NULL,                                   NULL,                   '2024-10-10T00:00:00Z', 5),
  (11, 'null-company', 'nc@example.com',    50,  9,     'active',   true,  'h11', NULL,                                   NULL,                   '2024-11-11T00:00:00Z', NULL),
  (12, 'back\slash',   'bs@example.com',    60,  11,    'pending',  true,  'h12', NULL,                                   NULL,                   '2024-12-12T00:00:00Z', 1),
  (13, 'globex_user',  'gx@example.com',    35,  3,     NULL,       true,  'h13', NULL,                                   NULL,                   '2024-03-10T20:00:00Z', 6);
SELECT setval('users_id_seq', 13);

INSERT INTO orders (id, code, user_id) VALUES
  (1, 'A', 1),
  (2, 'B', 1),
  (3, 'C', 2),
  (4, 'A', 4),
  (5, NULL, 3);
SELECT setval('orders_id_seq', 5);
