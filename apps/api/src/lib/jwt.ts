import jwt, { type SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { UserRole } from '@nexaops/shared';

export interface JwtPayload {
  userId: string;
  organizationId: string;
  role: UserRole;
  email: string;
  jti?: string;
}

function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 16) {
    throw new Error(`${name} não configurada (mínimo 16 caracteres). Defina no .env`);
  }
  return value;
}

export function signAccessToken(payload: JwtPayload): string {
  const options: SignOptions = { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as jwt.SignOptions['expiresIn'] };
  return jwt.sign({ ...payload, jti: randomUUID() }, requireSecret('JWT_SECRET'), options);
}

export function signRefreshToken(payload: JwtPayload): string {
  const options: SignOptions = { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'] };
  return jwt.sign({ ...payload, jti: randomUUID() }, requireSecret('JWT_REFRESH_SECRET'), options);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, requireSecret('JWT_SECRET')) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, requireSecret('JWT_REFRESH_SECRET')) as JwtPayload;
}
