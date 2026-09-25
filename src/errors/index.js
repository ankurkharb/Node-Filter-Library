/**
 * Structured errors (framework-agnostic).
 *
 * Two families:
 *
 * - `FilteringError` and its subclasses describe a problem with the *client's*
 *   request. They carry `status = 400` and serialize with `toJSON()`.
 * - `ConfigurationError` describes a mistake in the *developer's* filter
 *   configuration. It deliberately does NOT extend `FilteringError`, so an
 *   `instanceof FilteringError` check in an error handler never turns a server
 *   bug into a 400.
 */

export class FilteringError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, field?: string, lookup?: string, value?: unknown, details?: object }} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = 'FilteringError';
    this.code = meta.code || 'filtering_error';
    this.status = 400;
    this.field = meta.field;
    this.lookup = meta.lookup;
    this.value = meta.value;
    this.details = meta.details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      field: this.field,
      lookup: this.lookup,
      value: this.value,
      details: this.details,
    };
  }
}

/** Base class for every "the client sent an invalid filter/search/ordering" error. */
export class FilterValidationError extends FilteringError {
  constructor(message, meta = {}) {
    super(message, { code: 'filter_validation_error', ...meta });
    this.name = 'FilterValidationError';
  }
}

/** Param is not a declared filter (only with `unknownFilterBehavior: 'error'`). */
export class UnknownFilterError extends FilterValidationError {
  constructor(message, meta = {}) {
    super(message, { code: 'unknown_filter', ...meta });
    this.name = 'UnknownFilterError';
  }
}

/** Not thrown by the built-in backends; available to custom backends. */
export class UnknownFieldError extends FilterValidationError {
  constructor(message, meta = {}) {
    super(message, { code: 'unknown_field', ...meta });
    this.name = 'UnknownFieldError';
  }
}

/** Declared filter, known lookup, but the lookup is not enabled for it (`unknownFilterBehavior: 'error'`). */
export class InvalidLookupError extends FilterValidationError {
  constructor(message, meta = {}) {
    super(message, { code: 'invalid_lookup', ...meta });
    this.name = 'InvalidLookupError';
  }
}

/** Declared filter with a suffix that is not a lookup at all (`unknownFilterBehavior: 'error'`). */
export class UnsupportedLookupError extends FilterValidationError {
  constructor(message, meta = {}) {
    super(message, { code: 'unsupported_lookup', ...meta });
    this.name = 'UnsupportedLookupError';
  }
}

export class InvalidValueError extends FilterValidationError {
  constructor(message, meta = {}) {
    super(message, { code: 'invalid_value', ...meta });
    this.name = 'InvalidValueError';
  }
}

/** Ordering term not allowed (only with `invalidOrderingBehavior: 'error'`). */
export class InvalidOrderingError extends FilterValidationError {
  constructor(message, meta = {}) {
    super(message, { code: 'invalid_ordering', ...meta });
    this.name = 'InvalidOrderingError';
  }
}

export class InvalidSearchError extends FilterValidationError {
  constructor(message, meta = {}) {
    super(message, { code: 'invalid_search', ...meta });
    this.name = 'InvalidSearchError';
  }
}

/** Not thrown by the built-in backends (relationships are configured, not client-chosen); available to custom backends. */
export class InvalidRelationshipError extends FilterValidationError {
  constructor(message, meta = {}) {
    super(message, { code: 'invalid_relationship', ...meta });
    this.name = 'InvalidRelationshipError';
  }
}

/** A configured resource limit was exceeded (`maxInValues`, `maxFilters`, `maxSearchTerms`). */
export class SecurityLimitError extends FilteringError {
  constructor(message, meta = {}) {
    super(message, { code: 'security_limit', ...meta });
    this.name = 'SecurityLimitError';
  }
}

/** The developer's configuration is invalid. Map to HTTP 500, never 400. */
export class ConfigurationError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   */
  constructor(message, details) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = 'configuration_error';
    this.details = details;
  }
}
