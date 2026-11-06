/** Every API error has this shape, so web and mobile show one kind of message. */
export const ErrorCode = {
  VALIDATION: 'validation_failed',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  CODE_INVALID: 'code_invalid',
  CODE_EXPIRED: 'code_expired',
  CODE_LOCKED: 'code_locked',
  EMAIL_LINK_REQUIRED: 'email_link_required',
  PHONE_TAKEN: 'phone_taken',
  EMAIL_TAKEN: 'email_taken',
  ACCOUNT_DISABLED: 'account_disabled',
  SESSION_REVOKED: 'session_revoked',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  INTERNAL: 'internal_error',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown>; requestId?: string };
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: ErrorCode, message: string, public readonly details?: Record<string, unknown>, public readonly requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
  /** Seconds the caller should wait, when the server rate-limited the request. */
  get retryAfter(): number | undefined {
    const v = this.details?.retryAfter;
    return typeof v === 'number' ? v : undefined;
  }
}
