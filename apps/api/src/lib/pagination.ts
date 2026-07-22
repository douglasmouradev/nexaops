import type { Request } from 'express';

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(req: Request, defaults: { limit?: number; maxLimit?: number } = {}): PaginationParams {
  const maxLimit = defaults.maxLimit ?? 100;
  const defaultLimit = defaults.limit ?? 25;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(req.query.limit || String(defaultLimit)), 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function paginationMeta(total: number, page: number, limit: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
