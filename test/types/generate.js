// Generates the TypeScript files that `npm run test:types` compiles, into
// test/types/generated/ (not committed):
//
// - runtime-parity.ts: every name list in types/index.d.ts (option names,
//   filter types, lookups, context and method-argument fields, backend
//   methods, ...) must equal the list the running code has. Checked both ways,
//   so a new option in src/ without a type fails, and so does a stale type.
// - docs/*.js: every ```js example in the docs, which must type-check as
//   JavaScript (what a Node developer's editor checks).

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as lib from '../../src/index.js';
import { FIELD_TYPES } from '../../src/core/filterset.js';

const root = new URL('../../', import.meta.url);
const out = new URL('generated/', import.meta.url);

// Backend methods that are internal helpers, not documented override points,
// so they are left out of the types on purpose.
const INTERNAL_MEMBERS = {
  DjangoFilterBackend: [
    'applyResult',
    'checkUnknownParams',
    'coerce',
    'dayStart',
    'deferModelChoiceCheck',
    'evaluate',
    'evaluateList',
    'evaluateWidget',
  ],
  SearchFilter: ['compile', 'fieldCondition'],
};

const union = (names) => [...new Set(names)].map((n) => JSON.stringify(n)).join(' | ') || 'never';

/** A `new Set([...])` literal from a source file, for sets the modules do not export. */
async function sourceSet(file, name) {
  const source = await readFile(new URL(file, root), 'utf8');
  const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
  if (!match) throw new Error(`${name} not found in ${file}`);
  const items = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (items.length === 0) throw new Error(`${name} in ${file} is empty`);
  return items;
}

/** Instance fields plus methods up the prototype chain, as a TypeScript `keyof` would list them. */
function memberNames(Class) {
  const names = new Set(Object.keys(new Class()));
  for (let proto = Class.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) if (name !== 'constructor') names.add(name);
  }
  for (const name of INTERNAL_MEMBERS[Class.name] ?? []) names.delete(name);
  return [...names];
}

async function runtimeLists() {
  let context;
  let methodArgs;
  const filtering = lib.createFiltering({
    filterSet: lib.defineFilterSet({
      flag: {
        type: 'boolean',
        method: (args) => {
          methodArgs = args;
        },
      },
    }),
    backends: [
      lib.DjangoFilterBackend,
      (ctx) => {
        context = ctx;
      },
    ],
  });
  filtering.apply({ query: '?flag=true' });

  const comparisons = [...lib.ALL_LOOKUPS].filter((name) => !(name in lib.TRANSFORMS));
  const transforms = Object.keys(lib.TRANSFORMS);
  const candidates = [...lib.ALL_LOOKUPS, ...transforms.flatMap((t) => comparisons.map((c) => `${t}__${c}`))];

  const coercible = [...FIELD_TYPES].filter((type) => {
    try {
      lib.coerceValue(type, '1', { choices: ['1'] });
      return true;
    } catch (err) {
      return !(err instanceof TypeError);
    }
  });

  const filterSet = lib.defineFilterSet({ a: true });
  return {
    'CreateFilteringOptions keys': [
      await sourceSet('src/core/createFiltering.js', 'OPTIONS'),
      'keyof T.CreateFilteringOptions',
    ],
    'FilterDefinition keys': [await sourceSet('src/core/filterset.js', 'DEF_KEYS'), 'keyof T.FilterDefinition'],
    FilterType: [[...FIELD_TYPES], 'T.FilterType'],
    ComparisonLookup: [comparisons, 'T.ComparisonLookup'],
    TransformName: [transforms, 'T.TransformName'],
    LookupName: [candidates.filter((name) => lib.parseLookup(name)), 'T.LookupName'],
    'coerceValue types': [coercible, 'Parameters<typeof T.coerceValue>[0]'],
    'SecurityOptions keys': [Object.keys(lib.DEFAULT_SECURITY), 'keyof T.SecurityOptions'],
    'FilteringConfig keys': [Object.keys(filtering.config), 'keyof T.FilteringConfig'],
    'Filtering keys': [Object.keys(filtering), 'keyof T.Filtering'],
    'FilterContext keys': [Object.keys(context), 'keyof T.FilterContext'],
    'FilterMethodArgs keys': [Object.keys(methodArgs), 'keyof T.FilterMethodArgs'],
    'QueryState keys': [Object.keys(lib.createQueryState()), 'keyof T.QueryState'],
    'NormalizedFilter keys': [Object.keys(filterSet.get('a')), 'keyof T.NormalizedFilter'],
    'FilterSet keys': [Object.keys(filterSet), 'Exclude<keyof T.FilterSet, symbol>'],
    'resolveFilterParam result keys': [
      Object.keys(lib.resolveFilterParam('a', filterSet)),
      'keyof NonNullable<ReturnType<typeof T.resolveFilterParam>>',
    ],
    'ParsedLookup keys': [Object.keys(lib.parseLookup('year__gte')), 'keyof T.ParsedLookup'],
    'OrderingTerm keys': [Object.keys(lib.parseOrdering('-a')[0]), 'keyof T.OrderingTerm'],
    'TimeZone keys': [Object.keys(lib.resolveTimeZone('UTC')), 'keyof T.TimeZone'],
    'FilteringErrorJSON keys': [Object.keys(new lib.FilteringError('x').toJSON()), 'keyof T.FilteringErrorJSON'],
    'SEARCH_PREFIXES keys': [Object.keys(lib.SEARCH_PREFIXES), 'keyof typeof T.SEARCH_PREFIXES'],
    'TRANSFORMS keys': [transforms, 'keyof typeof T.TRANSFORMS'],
    ...Object.fromEntries(
      ['BaseFilterBackend', 'DjangoFilterBackend', 'SearchFilter', 'OrderingFilter'].map((name) => [
        `${name} members`,
        [memberNames(lib[name]), `keyof T.${name}`],
      ]),
    ),
  };
}

async function writeParity() {
  const lines = [
    '// Generated by test/types/generate.js. Each line fails to compile with the',
    '// offending name if the runtime and types/index.d.ts disagree.',
    "import type * as T from 'drf-sequelize-filter';",
    '',
    '/** Compiles only when T is `never`, i.e. nothing is missing. */',
    'declare function none<Missing extends never>(): void;',
    '',
  ];
  for (const [label, [names, typeExpr]] of Object.entries(await runtimeLists())) {
    const runtime = union(names);
    lines.push(`// ${label}`);
    lines.push(`none<Exclude<${runtime}, ${typeExpr}>>(); // in the code, missing from the types`);
    lines.push(`none<Exclude<${typeExpr}, ${runtime}>>(); // in the types, not in the code`);
  }
  // Values that are single literals at runtime.
  lines.push(`const _defaultLookup: typeof T.DEFAULT_LOOKUP = ${JSON.stringify(lib.DEFAULT_LOOKUP)};`);
  for (const [prefix, lookup] of Object.entries(lib.SEARCH_PREFIXES)) {
    lines.push(
      `const _prefix${lookup}: (typeof T.SEARCH_PREFIXES)[${JSON.stringify(prefix)}] = ${JSON.stringify(lookup)};`,
    );
  }
  for (const [name, type] of Object.entries(lib.TRANSFORMS)) {
    lines.push(`const _transform_${name}: (typeof T.TRANSFORMS)[${JSON.stringify(name)}] = ${JSON.stringify(type)};`);
  }
  lines.push(
    `const _configCode: T.ConfigurationError['code'] = ${JSON.stringify(new lib.ConfigurationError('x').code)};`,
  );
  lines.push(`const _status: T.FilteringError['status'] = ${new lib.FilteringError('x').status};`);
  await writeFile(new URL('runtime-parity.ts', out), `${lines.join('\n')}\n`);
}

// Names the doc examples use without defining them, with their types.
const DOC_GLOBALS = {
  User: "import('sequelize').ModelStatic<import('sequelize').Model<any, any>>",
  Product: "import('sequelize').ModelStatic<import('sequelize').Model<any, any>>",
  Company: "import('sequelize').ModelStatic<import('sequelize').Model<any, any>>",
  filtering: "import('drf-sequelize-filter').Filtering",
  filterSet: "import('drf-sequelize-filter').FilterSet",
  UserFilterSet: "import('drf-sequelize-filter').FilterSet",
  STATUS_CHOICES: "import('drf-sequelize-filter').Choices",
  TAG_CHOICES: "import('drf-sequelize-filter').Choices",
  app: 'any',
  req: 'any',
  res: 'any',
  next: 'any',
  limit: 'number',
  offset: 'number',
};

async function writeDocExamples() {
  const exportNames = Object.keys(lib);
  const files = ['AGENTS.md', 'README.md', ...(await readdir(new URL('docs/', root))).map((f) => `docs/${f}`)];
  let count = 0;
  for (const file of files.filter((f) => f.endsWith('.md'))) {
    const markdown = await readFile(new URL(file, root), 'utf8');
    for (const [index, [, block]] of [...markdown.matchAll(/^```js\n([\s\S]*?)^```/gm)].entries()) {
      // The example's own imports are replaced by one import of everything.
      const body = block.replace(/^import [\s\S]*?from '[^']+';\n/gm, '');
      const defined = (name) =>
        new RegExp(`\\b(const|let|class|function)\\s+${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`).test(body);
      const unusedImports = exportNames.filter((name) => !new RegExp(`\\b${name}\\b`).test(body) || defined(name));
      const imports = exportNames.filter((name) => !unusedImports.includes(name));
      const source = [
        `// Generated from ${file}, example ${index + 1}.`,
        "import { DataTypes, Model, Op, Sequelize } from 'sequelize';",
        "import * as lib from 'drf-sequelize-filter';",
        imports.length > 0 ? `import { ${imports.join(', ')} } from 'drf-sequelize-filter';` : '',
        ...Object.entries(DOC_GLOBALS)
          .filter(([name]) => !defined(name))
          .map(([name, type]) => `const ${name} = /** @type {${type}} */ (/** @type {unknown} */ (undefined));`),
        'void [DataTypes, Model, Op, Sequelize, lib];',
        '',
        body,
        'export {};',
      ].join('\n');
      const name = `${file.replace(/[/.]/g, '_')}_${index + 1}.js`;
      await writeFile(new URL(`docs/${name}`, out), source);
      count += 1;
    }
  }
  if (count === 0) throw new Error('no ```js examples found in the docs');
}

await rm(out, { recursive: true, force: true });
await mkdir(new URL('docs/', out), { recursive: true });
await writeParity();
await writeDocExamples();
