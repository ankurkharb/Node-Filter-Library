/**
 * BaseFilterBackend — DRF `BaseFilterBackend` equivalent.
 *
 * DRF: `filter_queryset(request, queryset, view)` returns a queryset.
 * Here: `apply(context)` receives the request, model, view and the query
 * state built so far, adds to it (use `andWhere`), and returns it.
 */
export class BaseFilterBackend {
  /**
   * @param {import('../core/createFiltering.js').FilterContext} context
   * @returns {import('../core/createFiltering.js').FilterContext['queryState']}
   */
  apply(context) {
    return context.queryState;
  }
}

export default BaseFilterBackend;
