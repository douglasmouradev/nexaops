import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

const TWO_FA_ALLOWLIST = [
  '/api/auth/me',
  '/api/auth/2fa/setup',
  '/api/auth/2fa/enable',
  '/api/auth/logout',
  '/api/auth/refresh',
];

function pathAllowsWithout2FA(originalUrl: string): boolean {
  const path = originalUrl.split('?')[0];
  return TWO_FA_ALLOWLIST.some((p) => path === p || path.startsWith(`${p}/`));
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Token não fornecido' });
    return;
  }

  try {
    const token = header.slice(7);
    req.user = verifyAccessToken(token);
  } catch {
    res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
    return;
  }

  if (pathAllowsWithout2FA(req.originalUrl || req.url)) {
    next();
    return;
  }

  void (async () => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: {
          twoFactorEnabled: true,
          organization: { select: { requireTwoFactor: true } },
        },
      });
      if (user?.organization.requireTwoFactor && !user.twoFactorEnabled) {
        res.status(403).json({
          success: false,
          error: 'Ative o 2FA para continuar',
          code: '2FA_SETUP_REQUIRED',
        });
        return;
      }
      next();
    } catch {
      res.status(500).json({ success: false, error: 'Falha ao validar 2FA' });
    }
  })();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Permissão insuficiente' });
      return;
    }
    next();
  };
}

/** ADMIN e TECHNICIAN podem escrever; READ_ONLY só leitura */
export const requireWrite = requireRole('ADMIN', 'TECHNICIAN');
