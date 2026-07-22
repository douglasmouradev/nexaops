import { Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AuthRequest } from './auth.js';

function extractEntityId(body: unknown, req: AuthRequest): string | undefined {
  const data = (body as { data?: unknown })?.data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.id === 'string') return obj.id;
    if (Array.isArray(obj.executionIds) && typeof obj.executionIds[0] === 'string') {
      return obj.executionIds[0];
    }
    if (Array.isArray(obj.executions) && obj.executions[0] && typeof (obj.executions[0] as { id?: string }).id === 'string') {
      return (obj.executions[0] as { id: string }).id;
    }
  }
  const paramId = req.params?.id;
  return typeof paramId === 'string' ? paramId : undefined;
}

/**
 * Middleware que registra auditoria após resposta de sucesso (< 400).
 * Uso: router.post('/', authenticate, auditLog('CREATE', 'Device'), handler)
 */
export function auditLog(action: string, entity: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);

    res.json = function patchedJson(body: unknown) {
      const status = res.statusCode || 200;
      if (status < 400 && req.user) {
        const entityId = extractEntityId(body, req);
        void prisma.auditLog
          .create({
            data: {
              action,
              entity,
              entityId,
              userId: req.user.userId,
              organizationId: req.user.organizationId,
              details: {
                method: req.method,
                path: req.originalUrl || req.path,
                status,
              } as Prisma.InputJsonValue,
            },
          })
          .catch(() => {
            /* nunca quebrar a request por falha de audit */
          });
      }
      return originalJson(body);
    };

    next();
  };
}

export async function writeAudit(
  organizationId: string,
  action: string,
  entity: string,
  userId?: string,
  entityId?: string,
  details?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity,
        entityId,
        userId,
        organizationId,
        details: details as Prisma.InputJsonValue,
      },
    });
  } catch {
    /* ignore */
  }
}
