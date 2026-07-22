import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import type { Organization } from '@prisma/client';

export type PortalOrg = Pick<Organization, 'id' | 'name' | 'slug' | 'portalToken'>;

/**
 * Resolve organização do portal via slug + portalToken.
 * Preferir header `X-Portal-Token`. Query `?token=` só se PORTAL_ALLOW_QUERY_TOKEN=true
 * (em production o default é negar query).
 */
export function allowPortalQueryToken(): boolean {
  if (process.env.PORTAL_ALLOW_QUERY_TOKEN === 'true') return true;
  if (process.env.PORTAL_ALLOW_QUERY_TOKEN === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export async function resolvePortalOrg(
  req: Request,
  res: Response
): Promise<PortalOrg | null> {
  const orgSlug =
    (req.query.org as string) ||
    (req.body?.orgSlug as string) ||
    (req.body?.org as string) ||
    undefined;
  const headerToken =
    typeof req.headers['x-portal-token'] === 'string'
      ? req.headers['x-portal-token']
      : undefined;
  const token =
    headerToken ||
    (req.body?.token as string) ||
    (allowPortalQueryToken() ? (req.query.token as string) : undefined) ||
    undefined;

  if (!orgSlug) {
    res.status(400).json({ success: false, error: 'org é obrigatório' });
    return null;
  }
  if (!token) {
    res.status(401).json({ success: false, error: 'Token do portal é obrigatório' });
    return null;
  }

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, slug: true, portalToken: true },
  });

  if (!org || org.portalToken !== token) {
    res.status(401).json({ success: false, error: 'Token do portal inválido' });
    return null;
  }

  return org;
}
