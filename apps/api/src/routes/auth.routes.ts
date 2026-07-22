import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  inviteUserSchema,
  enable2FASchema,
  acceptInviteSchema,
} from '@nexaops/shared';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import * as authService from '../services/auth.service.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

const authStrictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});


/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Registrar nova organização e usuário admin
 */
router.post('/register', authStrictLimiter, validateBody(registerSchema), async (req, res: Response) => {
  try {
    const result = await authService.registerUser(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login com e-mail e senha
 */
router.post('/login', authStrictLimiter, validateBody(loginSchema), async (req, res: Response) => {
  try {
    const result = await authService.loginUser(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = (err as Error).message;
    if (message === '2FA_REQUIRED') {
      res.status(401).json({ success: false, error: message, requires2FA: true });
      return;
    }
    res.status(401).json({ success: false, error: message });
  }
});

router.post('/refresh', validateBody(refreshTokenSchema), async (req, res: Response) => {
  try {
    const tokens = await authService.refreshTokens(req.body.refreshToken);
    res.json({ success: true, data: tokens });
  } catch (err) {
    res.status(401).json({ success: false, error: (err as Error).message });
  }
});

router.post('/forgot-password', validateBody(forgotPasswordSchema), async (req, res: Response) => {
  try {
    await authService.forgotPassword(req.body.email);
    res.json({ success: true, data: { message: 'Se o e-mail existir, um link foi enviado' } });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.post('/reset-password', validateBody(resetPasswordSchema), async (req, res: Response) => {
  try {
    await authService.resetPassword(req.body.token, req.body.password);
    res.json({ success: true, data: { message: 'Senha alterada com sucesso' } });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { organization: true },
  });
  if (!user) {
    res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    return;
  }
  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.name,
      twoFactorEnabled: user.twoFactorEnabled,
      mustEnable2FA: Boolean(user.organization.requireTwoFactor) && !user.twoFactorEnabled,
      notifyCriticalAlerts: user.notifyCriticalAlerts,
      notifyAlertSeverities: user.notifyAlertSeverities,
    },
  });
});

router.patch('/me/preferences', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const data: { notifyCriticalAlerts?: boolean; notifyAlertSeverities?: string } = {};
    if (typeof req.body?.notifyCriticalAlerts === 'boolean') {
      data.notifyCriticalAlerts = req.body.notifyCriticalAlerts;
    }
    if (typeof req.body?.notifyAlertSeverities === 'string') {
      data.notifyAlertSeverities = String(req.body.notifyAlertSeverities)
        .split(',')
        .map((s: string) => s.trim().toUpperCase())
        .filter((s: string) => ['CRITICAL', 'WARNING', 'INFO'].includes(s))
        .join(',') || 'CRITICAL';
    }
    if (Object.keys(data).length === 0) {
      res.status(400).json({
        success: false,
        error: 'Informe notifyCriticalAlerts e/ou notifyAlertSeverities',
      });
      return;
    }
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data,
      include: { organization: true },
    });
    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: user.organization.name,
        twoFactorEnabled: user.twoFactorEnabled,
        notifyCriticalAlerts: user.notifyCriticalAlerts,
        notifyAlertSeverities: user.notifyAlertSeverities,
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.post('/2fa/setup', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await authService.setup2FA(req.user!.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.post('/2fa/enable', authenticate, validateBody(enable2FASchema), auditLog('ENABLE_2FA', 'User'), async (req: AuthRequest, res: Response) => {
  try {
    await authService.enable2FA(req.user!.userId, req.body.totpCode);
    res.json({ success: true, data: { message: '2FA ativado com sucesso' } });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.post(
  '/invite',
  authenticate,
  requireRole('ADMIN'),
  validateBody(inviteUserSchema),
  auditLog('INVITE', 'User'),
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await authService.inviteMember(req.user!.organizationId, req.body);
      const allowTokenInResponse =
        process.env.ALLOW_INVITE_TOKEN_IN_RESPONSE === 'true' ||
        (process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST);

      res.status(201).json({
        success: true,
        data: {
          invitationId: result.invitationId,
          // Em production com SMTP: token só no e-mail (não na resposta JSON)
          ...(allowTokenInResponse ? { token: result.token } : {}),
          inviteLinkSent: Boolean(process.env.SMTP_HOST),
        },
      });
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

router.post('/accept-invite', validateBody(acceptInviteSchema), async (req, res: Response) => {
  try {
    const result = await authService.acceptInvitation(req.body.token, req.body.password);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

export default router;
