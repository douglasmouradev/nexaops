import type { AuthRequest } from '../middleware/auth.js';

/** Filtros comuns de relatórios: from, to (ISO), siteId */
export function parseReportFilters(req: AuthRequest): {
  from?: Date;
  to?: Date;
  siteId?: string;
  createdAt?: { gte?: Date; lte?: Date };
} {
  const fromStr = typeof req.query.from === 'string' ? req.query.from : undefined;
  const toStr = typeof req.query.to === 'string' ? req.query.to : undefined;
  const siteId = typeof req.query.siteId === 'string' && req.query.siteId ? req.query.siteId : undefined;

  const from = fromStr ? new Date(fromStr) : undefined;
  const to = toStr ? new Date(toStr) : undefined;
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from && !Number.isNaN(from.getTime())) createdAt.gte = from;
  if (to && !Number.isNaN(to.getTime())) {
    // fim do dia se for só data (sem hora)
    const end = new Date(to);
    if (toStr && /^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      end.setHours(23, 59, 59, 999);
    }
    createdAt.lte = end;
  }

  return {
    from: createdAt.gte,
    to: createdAt.lte,
    siteId,
    createdAt: Object.keys(createdAt).length ? createdAt : undefined,
  };
}
