import type { ErrorRequestHandler } from 'express';

export const jsonErrorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
};

