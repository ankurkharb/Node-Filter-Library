"""
Run every case in ../cases.json through a real DRF view and print JSON results.

    DATABASE_URL=postgres://user:pass@host:5432/db python runner.py
"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import django
from django.conf import settings

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

url = urlparse(os.environ.get('DATABASE_URL', 'postgres://localhost:5432/drf_sequelize_filter_compat'))
settings.configure(
    DEBUG=False,
    SECRET_KEY='compatibility-suite',
    USE_TZ=True,
    TIME_ZONE=os.environ.get('COMPAT_TIME_ZONE', 'Asia/Kolkata'),
    INSTALLED_APPS=[
        'django.contrib.contenttypes',
        'django.contrib.auth',
        'django.contrib.postgres',
        'rest_framework',
        'django_filters',
        'refapp',
    ],
    DATABASES={
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': url.path.lstrip('/'),
            'HOST': url.hostname or '',
            'PORT': str(url.port or ''),
            'USER': unquote(url.username or ''),
            'PASSWORD': unquote(url.password or ''),
        }
    },
    ROOT_URLCONF=__name__,
    REST_FRAMEWORK={'DEFAULT_FILTER_BACKENDS': [], 'UNAUTHENTICATED_USER': None},
)
django.setup()

from django_filters.rest_framework import DjangoFilterBackend  # noqa: E402
from rest_framework import filters, serializers, viewsets  # noqa: E402
from rest_framework.test import APIRequestFactory  # noqa: E402

from refapp.filters import UserFilter  # noqa: E402
from refapp.models import User  # noqa: E402

urlpatterns = []


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id']


def make_view(spec):
    attrs = {
        'queryset': User.objects.all(),
        'serializer_class': UserSerializer,
        'filter_backends': [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter],
        'filterset_class': UserFilter,
        'search_fields': spec.get('search_fields', []),
        'ordering_fields': spec.get('ordering_fields', []),
        'authentication_classes': [],
        'permission_classes': [],
    }
    if 'ordering' in spec:
        attrs['ordering'] = spec['ordering']
    return type('View', (viewsets.ReadOnlyModelViewSet,), attrs).as_view({'get': 'list'})


def run_case(view, query):
    request = APIRequestFactory().get('/users/' + query)
    try:
        response = view(request)
        response.render()
    except Exception as exc:  # database errors etc. surface as HTTP 500 in a real deployment
        return {'status': 500, 'error': f'{type(exc).__name__}: {str(exc).splitlines()[0][:200]}'}
    body = json.loads(response.content)
    if response.status_code != 200:
        fields = sorted(body.keys()) if isinstance(body, dict) else []
        return {'status': response.status_code, 'errorFields': fields, 'error': body}
    return {'status': 200, 'ids': [row['id'] for row in body]}


def main():
    views = {name: make_view(spec) for name, spec in json.loads((ROOT / 'views.json').read_text()).items()}
    cases = json.loads((ROOT / 'cases.json').read_text())
    print(json.dumps({case['id']: run_case(views[case['view']], case['query']) for case in cases}))


if __name__ == '__main__':
    main()
