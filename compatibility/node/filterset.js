import { defineFilterSet } from '../../src/index.js';

const STATUS = ['active', 'pending', 'inactive'];

/** The same filters as ../drf-reference/refapp/filters.py. */
export const UserFilterSet = defineFilterSet({
  // class Meta: fields = {...}  → generated filters, types inferred from the model
  username: {
    lookups: [
      'exact',
      'iexact',
      'contains',
      'icontains',
      'startswith',
      'istartswith',
      'endswith',
      'iendswith',
      'in',
      'isnull',
      'regex',
      'iregex',
    ],
  },
  email: { lookups: ['exact', 'icontains', 'isnull'] },
  age: { lookups: ['exact', 'gt', 'gte', 'lt', 'lte', 'in', 'range', 'isnull', 'icontains'] },
  score: { lookups: ['exact', 'gte', 'lte', 'isnull'] },
  is_active: { lookups: ['exact', 'isnull'] },
  uid: { lookups: ['exact', 'in', 'isnull'] },
  deleted_at: { lookups: ['isnull', 'gte', 'lt'] },
  created_at: {
    lookups: [
      'exact',
      'gte',
      'lt',
      'range',
      'date',
      'date__lt',
      'time',
      'year',
      'year__gte',
      'iso_year',
      'month',
      'day',
      'week',
      'week_day',
      'iso_week_day',
      'quarter',
      'hour',
    ],
  },
  company__name: { lookups: ['exact', 'icontains', 'in', 'isnull'] },
  company__country: { lookups: ['exact', 'isnull'] },
  company__departments__name: { lookups: ['exact', 'icontains'] },
  orders__code: { lookups: ['exact', 'in', 'isnull'] },

  // Declared filters
  status: { type: 'choice', choices: STATUS },
  status__in: { type: 'choice', choices: STATUS, field: 'status', lookup: 'in' },
  status_multi: { type: 'multipleChoice', choices: STATUS, field: 'status' },
  status_all: { type: 'multipleChoice', choices: STATUS, field: 'status', conjoined: true },
  status_or_null: { type: 'choice', choices: STATUS, field: 'status', nullValue: 'null' },
  age_band: { type: 'range', field: 'age' },
  created: { type: 'dateFromToRange', field: 'created_at' },
  created_dt: { type: 'datetimeFromToRange', field: 'created_at' },
  company: { type: 'modelChoice' },
  companies: { type: 'modelMultipleChoice', field: 'company' },
  not_age: { type: 'number', field: 'age', exclude: true },
  not_country: { type: 'string', path: ['company'], field: 'country', exclude: true },
  min_age: { field: 'age', lookup: 'gte' },
});
