import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { ErrorCode, type ApiErrorBody } from '@yays/shared';
import type { Request, Response } from 'express';
import { AppError } from './app-error';
import type { Logger } from './logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly log: Logger) {}
  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    let status = 500, code: ErrorCode = ErrorCode.INTERNAL, message = 'Something went wrong on our side. Try again.', details: Record<string, unknown> | undefined;
    if (err instanceof AppError) { status = err.status; code = err.code; message = err.message; details = err.details; }
    else if (err instanceof HttpException) {
      status = err.getStatus();
      if (status === 404) { code = ErrorCode.NOT_FOUND; message = 'Not found.'; }
      else if (status === 413) { code = ErrorCode.VALIDATION; message = 'That request is too large.'; }
      else if (status === 400) { code = ErrorCode.VALIDATION; message = 'The request could not be read. Check it and try again.'; }
      else if (status < 500) { code = ErrorCode.VALIDATION; message = err.message; }
    } else if ((err as { type?: string })?.type === 'entity.parse.failed') { status = 400; code = ErrorCode.VALIDATION; message = 'The request body is not valid JSON.'; }
    else if ((err as { type?: string })?.type === 'entity.too.large') { status = 413; code = ErrorCode.VALIDATION; message = 'That request is too large.'; }
    if (status >= 500) {
      this.log.error({ err, requestId: req.id, path: req.url }, 'request failed');
      Sentry.captureException(err);
    }
    if (status === 429 && details?.retryAfter) res.setHeader('Retry-After', String(details.retryAfter));
    const body: ApiErrorBody = { error: { code, message, ...(details ? { details } : {}), requestId: req.id } };
    res.status(status).json(body);
  }
}
