#!/usr/bin/env node
/**
 * DRF ↔ Node compatibility suite.
 *
 * Seeds one PostgreSQL database, runs every case in cases.json through a real
 * DRF + django-filter view and through this library, and compares the returned
 * record IDs, their order (for ordered cases) and error behavior.
 *
 *   TEST_DATABASE_URL=postgres://localhost:5432/drf_compat npm run test:compat [-- --write]
 *
 * --write regenerates docs/COMPATIBILITY_MATRIX.md from the results.
 * Exit code 1 if any case fails.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Sequelize } from 'sequelize';
import { defineModels } from './node/models.js';
import { runNode } from './node/runner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIME_ZONE = 'Asia/Kolkata';
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const PYTHON = process.env.DRF_PYTHON ?? path.join(HERE, 'drf-reference', '.venv', 'bin', 'python');

if (!DATABASE_URL) {
  console.error('Set TEST_DATABASE_URL to a disposable PostgreSQL database (its tables are dropped and re-created).');
  process.exit(2);
}
if (!existsSync(PYTHON)) {
  console.error(`Python for the DRF reference not found at ${PYTHON}. See compatibility/README.md, or set DRF_PYTHON.`);
  process.exit(2);
}

const views = JSON.parse(await readFile(path.join(HERE, 'views.json'), 'utf8'));
const cases = JSON.parse(await readFile(path.join(HERE, 'cases.json'), 'utf8'));

const sequelize = new Sequelize(DATABASE_URL, { logging: false });
await sequelize.query(await readFile(path.join(HERE, 'seed.sql'), 'utf8'));
const models = defineModels(sequelize);

const node = await runNode(models, views, cases, TIME_ZONE);
await sequelize.close();

const { stdout } = await promisify(execFile)(PYTHON, [path.join(HERE, 'drf-reference', 'runner.py')], {
  env: { ...process.env, DATABASE_URL, COMPAT_TIME_ZONE: TIME_ZONE },
  maxBuffer: 64 * 1024 * 1024,
});
const drf = JSON.parse(stdout);

const sameMultiset = (a, b) =>
  JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

/** @returns {{ verdict: 'PASS'|'EXPECTED'|'FAIL', detail: string }} */
function compare(c, n, d) {
  if (c.expect === 'node-rejects') {
    return n.status === 400
      ? { verdict: 'EXPECTED', detail: `DRF ${d.status}, library 400` }
      : { verdict: 'FAIL', detail: `library returned ${n.status}, expected 400` };
  }
  if (c.expect === 'differs') {
    const same = JSON.stringify(n.ids ?? n.status) === JSON.stringify(d.ids ?? d.status);
    return {
      verdict: 'EXPECTED',
      detail: same
        ? 'results happen to match'
        : `library ${JSON.stringify(n.ids ?? n.status)} DRF ${JSON.stringify(d.ids ?? d.status)}`,
    };
  }
  if (n.status === 200 && d.status === 200) {
    if (c.ordered) {
      return JSON.stringify(n.ids) === JSON.stringify(d.ids)
        ? { verdict: 'PASS', detail: `${n.ids.length} rows, same order` }
        : {
            verdict: 'FAIL',
            detail: `order/rows differ: library ${JSON.stringify(n.ids)} DRF ${JSON.stringify(d.ids)}`,
          };
    }
    if (sameMultiset(n.ids, d.ids)) return { verdict: 'PASS', detail: `${n.ids.length} rows` };
    if (sameMultiset(n.ids, [...new Set(d.ids)])) {
      return { verdict: 'EXPECTED', detail: 'same rows; DRF repeats a row once per matching related row' };
    }
    return { verdict: 'FAIL', detail: `rows differ: library ${JSON.stringify(n.ids)} DRF ${JSON.stringify(d.ids)}` };
  }
  if (n.status === d.status) {
    if (d.errorFields?.length && JSON.stringify(n.errorFields) !== JSON.stringify(d.errorFields)) {
      return {
        verdict: 'FAIL',
        detail: `both ${n.status}, error fields differ: library ${n.errorFields} DRF ${d.errorFields}`,
      };
    }
    return {
      verdict: 'PASS',
      detail: `both ${n.status}${d.errorFields?.length ? ` (${d.errorFields.join(', ')})` : ''}`,
    };
  }
  return {
    verdict: 'FAIL',
    detail: `library ${n.status}${n.ids ? ` ${JSON.stringify(n.ids)}` : ''} vs DRF ${d.status}${d.ids ? ` ${JSON.stringify(d.ids)}` : ''}`,
  };
}

const rows = cases.map((c) => ({ ...c, ...compare(c, node[c.id], drf[c.id]) }));
const count = (v) => rows.filter((r) => r.verdict === v).length;

for (const r of rows.filter((x) => x.verdict !== 'PASS')) {
  console.log(
    `${r.verdict.padEnd(8)} ${r.id.padEnd(16)} [${r.view}] ${r.query.slice(0, 70)}\n         ${r.detail}${r.note ? `\n         note: ${r.note}` : ''}`,
  );
}
console.log(
  `\n${rows.length} cases: ${count('PASS')} pass, ${count('EXPECTED')} documented differences, ${count('FAIL')} fail`,
);

if (process.argv.includes('--write')) {
  const escape = (s) => s.replaceAll('|', '\\|').replaceAll('`', "'");
  const categories = [...new Set(rows.map((r) => r.category))];
  const lines = [
    '# Compatibility Matrix',
    '',
    '_Generated by `npm run test:compat -- --write`. Do not edit by hand._',
    '',
    'Every case runs against a real **DRF + django-filter** view and against this library, over the',
    'same PostgreSQL database seeded from `compatibility/seed.sql`. Results are compared on returned',
    'record IDs, row order (ordered cases), HTTP status, and — for 400s — which fields the error names.',
    `Both sides use the time zone \`${TIME_ZONE}\`. See [compatibility/README.md](../compatibility/README.md).`,
    '',
    `**${rows.length} cases: ${count('PASS')} pass, ${count('EXPECTED')} documented differences, ${count('FAIL')} fail.**`,
    '',
    '- **PASS** — identical rows (and order, where the case is ordered) or identical error status and fields.',
    '- **EXPECTED** — a deliberate, documented difference: a security limit, a 400 where DRF would pass bad input',
    '  to PostgreSQL (500), DRF repeating a row once per matching related row, comma-only `?search=` splitting',
    '  (DRF also splits on whitespace and honors quotes), or DRF 3.15+ multi-term search',
    '  across a to-many relation. Each one is explained in its row.',
    '',
  ];
  for (const cat of categories) {
    lines.push(`## ${cat}`, '', '| Case | View | Query | Result | Detail |', '|---|---|---|---|---|');
    for (const r of rows.filter((x) => x.category === cat)) {
      const q = r.query.length > 80 ? `${r.query.slice(0, 77)}...` : r.query;
      const detail = r.note ? `${r.detail}. ${r.note}` : r.detail;
      lines.push(`| ${r.id} | ${r.view} | \`${escape(q) || '(none)'}\` | ${r.verdict} | ${escape(detail)} |`);
    }
    lines.push('');
  }
  await writeFile(path.join(HERE, '..', 'docs', 'COMPATIBILITY_MATRIX.md'), lines.join('\n'));
  console.log('Wrote docs/COMPATIBILITY_MATRIX.md');
}

process.exit(count('FAIL') > 0 ? 1 : 0);
