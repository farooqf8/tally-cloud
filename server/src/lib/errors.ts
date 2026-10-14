import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const bad = (msg: string) => new AppError(400, msg);
export const notFound = (what = 'Record') => new AppError(404, `${what} not found`);

// Postgres errors raised by our triggers and constraints carry user-facing text.
function pgMessage(err: any): { status: number; message: string } | null {
  const e = err?.cause ?? err;
  const code: string | undefined = e?.code;
  if (!code || typeof code !== 'string' || code.length !== 5) return null;
  if (code === '23505') return { status: 409, message: 'A master with this name already exists' };
  if (code === '23503') return { status: 409, message: 'This master is in use and cannot be deleted or changed this way' };
  if (code === '23514') {
    if (/trn/.test(e.message ?? '') && /constraint/.test(e.message ?? '')) return { status: 400, message: 'TRN must be exactly 15 digits' };
    return { status: 400, message: e.message };
  }
  return null;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) return void res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) {
    const i = err.issues[0];
    return void res.status(400).json({ error: `${i.path.join('.') || 'input'}: ${i.message}` });
  }
  const pgErr = pgMessage(err);
  if (pgErr) return void res.status(pgErr.status).json({ error: pgErr.message });
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
};
