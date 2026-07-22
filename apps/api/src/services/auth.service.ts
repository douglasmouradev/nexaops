import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from '../lib/prisma.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';
import { slugify } from '../lib/crypto.js';
import { sendPasswordResetEmail, sendInviteEmail } from '../lib/email.js';
import type { AuthUser, AuthTokens } from '@nexaops/shared';

const SALT_ROUNDS = 12;

export async function registerUser(data: {
  email: string;
  password: string;
  name: string;
  organizationName: string;
}): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new Error('E-mail já cadastrado');

  const slug = slugify(data.organizationName) + '-' + Date.now().toString(36);
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  const org = await prisma.organization.create({
    data: {
      name: data.organizationName,
      slug,
    },
  });

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      name: data.name,
      role: 'ADMIN',
      organizationId: org.id,
      allowedSiteIds: [],
    },
    include: { organization: true },
  });

  await seedDefaultIntegrations(org.id);
  await seedDefaultAiFeatures(org.id);

  const tokens = await createTokens(user);
  return {
    user: toAuthUser(user),
    tokens,
  };
}

export async function loginUser(data: {
  email: string;
  password: string;
  totpCode?: string;
}): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const user = await prisma.user.findUnique({
    where: { email: data.email },
    include: { organization: true },
  });

  if (!user) throw new Error('Credenciais inválidas');

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) throw new Error('Credenciais inválidas');

  if (user.twoFactorEnabled) {
    if (!data.totpCode) throw new Error('2FA_REQUIRED');
    const valid2fa = authenticator.verify({
      token: data.totpCode,
      secret: user.twoFactorSecret!,
    });
    if (!valid2fa) throw new Error('Código 2FA inválido');
  }

  const tokens = await createTokens(user);
  return { user: toAuthUser(user), tokens };
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const payload = verifyRefreshToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
  if (!stored || stored.expiresAt < new Date()) {
    throw new Error('Refresh token inválido');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { organization: true },
  });
  if (!user) throw new Error('Usuário não encontrado');

  await prisma.refreshToken.delete({ where: { id: stored.id } });
  return createTokens(user);
}

export async function setup2FA(userId: string): Promise<{ secret: string; qrCode: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Usuário não encontrado');

  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(user.email, 'NexaOps', secret);
  const qrCode = await QRCode.toDataURL(otpauth);

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret },
  });

  return { secret, qrCode };
}

export async function enable2FA(userId: string, totpCode: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFactorSecret) throw new Error('Configure o 2FA primeiro');

  const valid = authenticator.verify({ token: totpCode, secret: user.twoFactorSecret });
  if (!valid) throw new Error('Código inválido');

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });
}

export async function inviteMember(
  organizationId: string,
  data: { email: string; name: string; role: 'ADMIN' | 'TECHNICIAN' | 'READ_ONLY' }
): Promise<{ invitationId: string; token: string }> {
  const invitation = await prisma.invitation.create({
    data: {
      email: data.email,
      name: data.name,
      role: data.role,
      organizationId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    include: { organization: true },
  });
  await sendInviteEmail(data.email, data.name, invitation.token, invitation.organization.name);
  return { invitationId: invitation.id, token: invitation.token };
}

export async function forgotPassword(email: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return 'ok';

  const reset = await prisma.passwordReset.create({
    data: {
      email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await sendPasswordResetEmail(email, reset.token);
  return reset.token;
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const reset = await prisma.passwordReset.findUnique({ where: { token } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    throw new Error('Token inválido ou expirado');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  await prisma.user.update({
    where: { email: reset.email },
    data: { passwordHash },
  });
  await prisma.passwordReset.update({
    where: { id: reset.id },
    data: { usedAt: new Date() },
  });
}

export async function acceptInvitation(
  token: string,
  password: string
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { organization: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw new Error('Convite inválido ou expirado');
  }

  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existing) throw new Error('E-mail já cadastrado');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email: invitation.email,
      name: invitation.name,
      role: invitation.role,
      passwordHash,
      organizationId: invitation.organizationId,
      allowedSiteIds: [],
    },
    include: { organization: true },
  });

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date() },
  });

  const tokens = await createTokens(user);
  return { user: toAuthUser(user), tokens };
}

async function createTokens(user: {
  id: string;
  email: string;
  role: string;
  organizationId: string;
}): Promise<AuthTokens> {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role as 'ADMIN' | 'TECHNICIAN' | 'READ_ONLY',
    organizationId: user.organizationId,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken, refreshToken };
}

function toAuthUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  twoFactorEnabled: boolean;
  notifyCriticalAlerts?: boolean;
  notifyAlertSeverities?: string;
  organization: { name: string; requireTwoFactor?: boolean };
}): AuthUser {
  const orgRequires = Boolean(user.organization.requireTwoFactor);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as AuthUser['role'],
    organizationId: user.organizationId,
    organizationName: user.organization.name,
    twoFactorEnabled: user.twoFactorEnabled,
    mustEnable2FA: orgRequires && !user.twoFactorEnabled,
    notifyCriticalAlerts: user.notifyCriticalAlerts,
    notifyAlertSeverities: user.notifyAlertSeverities,
  };
}

async function seedDefaultIntegrations(orgId: string): Promise<void> {
  const integrations = [
    'microsoft', 'slack', 'teams', 'microsoft-365', 'stripe', 'quickbooks',
    'splashtop', 'anydesk', 'screenconnect', 'connectwise', 'autotask',
  ];
  await prisma.integration.createMany({
    data: integrations.map((slug) => ({
      name: slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      slug,
      organizationId: orgId,
    })),
  });
}

async function seedDefaultAiFeatures(orgId: string): Promise<void> {
  const features = [
    'ticket-summary', 'response-suggestion', 'script-generation', 'alert-triage',
    'parse-filter', 'assist',
  ];
  await prisma.aiFeatureToggle.createMany({
    data: features.map((feature) => ({ feature, organizationId: orgId })),
  });
}
