import type { ZodTypeAny, z } from 'zod';
import { AppError } from './app-error';

export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) { const k = i.path.join('.') || '_'; if (!fields[k]) fields[k] = i.message; }
  const first = Object.values(fields)[0] ?? 'Check the highlighted fields.';
  throw AppError.validation(first, { fields });
}
