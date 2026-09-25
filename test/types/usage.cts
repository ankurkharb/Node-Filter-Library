// The CommonJS entry resolves to the same types.

import lib = require('node-query-filter');

const filtering: lib.Filtering = lib.createFiltering({
  filterSet: lib.defineFilterSet({ age: ['gte'] }),
});
const options: lib.FilterOptions = filtering.apply({ query: '?age__gte=18' });
void options;

try {
  filtering.apply();
} catch (err) {
  if (err instanceof lib.FilteringError) void err.toJSON();
}
