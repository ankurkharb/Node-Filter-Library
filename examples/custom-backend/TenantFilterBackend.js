/**
 * Example: a custom backend in the same chain as the built-in ones — the
 * equivalent of a DRF `BaseFilterBackend` that scopes a queryset to the
 * current tenant.
 */

import { Op } from 'sequelize';
import { BaseFilterBackend, andWhere } from 'drf-sequelize-filter';

export class TenantFilterBackend extends BaseFilterBackend {
  apply(context) {
    // Take the tenant from the authenticated request (set by your auth
    // middleware), never from a client-controlled query param.
    const tenantId = context.request?.tenantId;

    // Fail closed: without a tenant, match nothing rather than everything.
    andWhere(context.queryState, { tenant_id: tenantId == null ? { [Op.in]: [] } : tenantId });
    return context.queryState;
  }
}

export default TenantFilterBackend;
