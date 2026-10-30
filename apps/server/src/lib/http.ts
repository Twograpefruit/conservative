import { SqlGuardError } from '@ocg/db';
import { RedisGuardError } from '@ocg/redis';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function badRequest(message: string, code = 'bad_request'): never {
  throw new HttpError(400, message, code);
}

export function notFound(message: string, code = 'not_found'): never {
  throw new HttpError(404, message, code);
}

export function conflict(message: string, details?: Record<string, unknown>): never {
  throw new HttpError(409, message, 'conflict', details);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) badRequest(`${field} is required`, 'invalid_field');
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function optionalBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function optionalNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function errorPayload(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      body: { error: err.code ?? 'error', message: err.message, ...(err.details ?? {}) },
    };
  }
  if (err instanceof SqlGuardError) {
    return {
      status: err.code === 'multiple_statements' ? 400 : 403,
      body: { error: err.code, message: err.message },
    };
  }
  if (err instanceof RedisGuardError) {
    return { status: 403, body: { error: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: 'internal_error', message } };
}
