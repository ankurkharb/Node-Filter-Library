"""Unmanaged models over the tables created by ../seed.sql."""

from django.db import models


class Company(models.Model):
    name = models.TextField(null=True)
    country = models.TextField(null=True)

    class Meta:
        db_table = 'companies'
        managed = False


class Department(models.Model):
    name = models.TextField(null=True)
    company = models.ForeignKey(
        Company, on_delete=models.DO_NOTHING, db_column='company_id', related_name='departments', null=True
    )

    class Meta:
        db_table = 'departments'
        managed = False


class User(models.Model):
    username = models.TextField(null=True)
    email = models.TextField(null=True)
    age = models.IntegerField(null=True)
    score = models.FloatField(null=True)
    status = models.TextField(null=True)
    is_active = models.BooleanField(null=True)
    password_hash = models.TextField(null=True)
    uid = models.UUIDField(null=True)
    deleted_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(null=True)
    company = models.ForeignKey(
        Company, on_delete=models.DO_NOTHING, db_column='company_id', related_name='users', null=True
    )

    class Meta:
        db_table = 'users'
        managed = False


class Order(models.Model):
    code = models.TextField(null=True)
    user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='user_id', related_name='orders', null=True)

    class Meta:
        db_table = 'orders'
        managed = False
