/**
 * Build the CommonJS entry (dist/index.cjs) from the ES module source, so
 * `require('drf-sequelize-filter')` works. The ESM source in src/ is
 * published as-is and stays the primary entry.
 */

import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist');

await build({
  entryPoints: ['src/index.js'],
  outfile: 'dist/index.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  // Use the application's Sequelize, never a bundled copy (Op symbols and
  // model classes must be the app's own).
  external: ['sequelize'],
  legalComments: 'none',
  logLevel: 'info',
});

// TypeScript resolves `require` types from a .d.cts next to the .cjs entry.
await copyFile('types/index.d.ts', 'dist/index.d.cts');
