import { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../lib/logger.js';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Encaminha rejeições de handlers async ao errorHandler do Express 4
 * (sem isso, Promise rejeitada vira unhandledRejection).
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('request_error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ success: false, error: 'Erro interno do servidor' });
}
