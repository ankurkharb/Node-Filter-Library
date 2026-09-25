// types/index.d.ts must declare exactly the runtime exports.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as lib from '../../src/index.js';

test('type declarations match the runtime exports', () => {
  const source = readFileSync(new URL('../../types/index.d.ts', import.meta.url), 'utf8');
  const declared = [...source.matchAll(/^export (?:declare )?(?:function|class|const) (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(declared)].sort(), Object.keys(lib).sort());
});

test('error classes extend the same parents as at runtime', () => {
  const source = readFileSync(new URL('../../types/index.d.ts', import.meta.url), 'utf8');
  const declared = Object.fromEntries(
    [...source.matchAll(/^export class (\w+Error) extends (\w+)/gm)].map((m) => [m[1], m[2]]),
  );
  const runtime = Object.fromEntries(
    Object.entries(lib)
      .filter(([name]) => name.endsWith('Error'))
      .map(([name, Class]) => [name, Object.getPrototypeOf(Class).name]),
  );
  assert.deepEqual(declared, runtime);
});
