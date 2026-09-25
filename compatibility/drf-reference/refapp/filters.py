"""The reference FilterSet. ../node/filterset.js declares the same filters."""

import django_filters as df
from django_filters.rest_framework import FilterSet

from .models import Company, User

STATUS = [('active', 'active'), ('pending', 'pending'), ('inactive', 'inactive')]


class ChoiceInFilter(df.BaseInFilter, df.ChoiceFilter):
    pass


class UserFilter(FilterSet):
    status = df.ChoiceFilter(choices=STATUS)
    status__in = ChoiceInFilter(field_name='status', lookup_expr='in', choices=STATUS)
    status_multi = df.MultipleChoiceFilter(field_name='status', choices=STATUS)
    status_all = df.MultipleChoiceFilter(field_name='status', choices=STATUS, conjoined=True)
    status_or_null = df.ChoiceFilter(field_name='status', choices=STATUS, null_label='None')
    age_band = df.RangeFilter(field_name='age')
    created = df.DateFromToRangeFilter(field_name='created_at')
    created_dt = df.DateTimeFromToRangeFilter(field_name='created_at')
    company = df.ModelChoiceFilter(queryset=Company.objects.all())
    companies = df.ModelMultipleChoiceFilter(field_name='company', queryset=Company.objects.all())
    not_age = df.NumberFilter(field_name='age', exclude=True)
    not_country = df.CharFilter(field_name='company__country', exclude=True)
    min_age = df.NumberFilter(field_name='age', lookup_expr='gte')

    class Meta:
        model = User
        fields = {
            'username': [
                'exact', 'iexact', 'contains', 'icontains', 'startswith', 'istartswith',
                'endswith', 'iendswith', 'in', 'isnull', 'regex', 'iregex',
            ],
            'email': ['exact', 'icontains', 'isnull'],
            'age': ['exact', 'gt', 'gte', 'lt', 'lte', 'in', 'range', 'isnull', 'icontains'],
            'score': ['exact', 'gte', 'lte', 'isnull'],
            'is_active': ['exact', 'isnull'],
            'uid': ['exact', 'in', 'isnull'],
            'deleted_at': ['isnull', 'gte', 'lt'],
            'created_at': [
                'exact', 'gte', 'lt', 'range', 'date', 'date__lt', 'time', 'year', 'year__gte', 'iso_year',
                'month', 'day', 'week', 'week_day', 'iso_week_day', 'quarter', 'hour',
            ],
            'company__name': ['exact', 'icontains', 'in', 'isnull'],
            'company__country': ['exact', 'isnull'],
            'company__departments__name': ['exact', 'icontains'],
            'orders__code': ['exact', 'in', 'isnull'],
        }
