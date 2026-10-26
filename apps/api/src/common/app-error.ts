import { ErrorCode } from '@yays/shared';

/** Throw this anywhere; the filter turns it into the shared error shape. */
export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: ErrorCode, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
  }
  static validation(message: string, details?: Record<string, unknown>) { return new AppError(400, ErrorCode.VALIDATION, message, details); }
  static unauthenticated(message = 'Please sign in again.') { return new AppError(401, ErrorCode.UNAUTHENTICATED, message); }
  static forbidden(message = "You can't do that.") { return new AppError(403, ErrorCode.FORBIDDEN, message); }
  static notFound(message = 'Not found.') { return new AppError(404, ErrorCode.NOT_FOUND, message); }
  static conflict(message: string, code: ErrorCode = ErrorCode.CONFLICT, details?: Record<string, unknown>) { return new AppError(409, code, message, details); }
  static rateLimited(retryAfter: number, message?: string) {
    return new AppError(429, ErrorCode.RATE_LIMITED, message ?? `Too many tries. Wait ${retryAfter} seconds and try again.`, { retryAfter });
  }
}
