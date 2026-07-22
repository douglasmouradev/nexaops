import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import os from 'os';

/** Diretório fonte do agent no monorepo */
export function resolveAgentSourceDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'apps/agent'),
    path.join(process.cwd(), '../agent'),
    path.join(__dirname, '../../../../agent'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.js'))) return c;
  }
  return null;
}

/**
 * Empacota apps/agent em .tgz (sem node_modules/installer/dist pesados).
 * Retorna path temporário do arquivo.
 */
export function buildAgentTarball(): string {
  const src = resolveAgentSourceDir();
  if (!src) throw new Error('Código do agent não encontrado (apps/agent)');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexaops-agent-'));
  const out = path.join(tmpDir, 'nexaops-agent.tgz');

  // Preferir tar nativo (disponível no Git Bash / WSL / Linux / macOS)
  try {
    execFileSync(
      'tar',
      [
        '-czf',
        out,
        '--exclude=node_modules',
        '--exclude=installer/dist',
        '--exclude=.git',
        '-C',
        src,
        '.',
      ],
      { stdio: 'pipe' }
    );
    return out;
  } catch {
    // Fallback: zip-like copy listing — mínimo sem tar
    throw new Error('tar não disponível no servidor — instale tar para pacotes Linux/macOS');
  }
}

/** Em production, query token do agent só com AGENT_ALLOW_QUERY_TOKEN=true */
export function allowAgentQueryToken(): boolean {
  if (process.env.AGENT_ALLOW_QUERY_TOKEN === 'true') return true;
  if (process.env.AGENT_ALLOW_QUERY_TOKEN === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/** Extrai agentToken de Authorization Bearer ou query/body */
export function extractAgentOrgToken(req: {
  headers: { authorization?: string };
  query: Record<string, unknown>;
  body?: Record<string, unknown>;
}): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  if (allowAgentQueryToken()) {
    const q = req.query.token;
    if (typeof q === 'string' && q) return q;
  }
  const b = req.body?.token;
  if (typeof b === 'string' && b) return b;
  return undefined;
}

function normalizeApiBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Allowlist de API_URL injetável em bootstraps do agent.
 * Fontes: API_URL, AGENT_API_URL_ALLOWLIST (CSV), localhost em non-prod.
 * Retorna null se o valor pedido for externo/não confiável.
 */
export function resolveTrustedAgentApiUrl(requested?: string | null): string | null {
  const fallback = normalizeApiBase(process.env.API_URL || 'http://localhost:3001');
  const allowLocalhost =
    process.env.NODE_ENV !== 'production' || process.env.ALLOW_LOCALHOST_CORS === 'true';

  const allowed = new Set<string>([fallback]);
  for (const part of (process.env.AGENT_API_URL_ALLOWLIST || '').split(',')) {
    const n = normalizeApiBase(part);
    if (n) allowed.add(n);
  }
  if (allowLocalhost) {
    allowed.add('http://localhost:3001');
    allowed.add('http://127.0.0.1:3001');
  }

  const raw = (requested || '').trim();
  if (!raw) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // Bloqueia userinfo (https://evil@trusted) e path/query inesperados no base
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname && parsed.pathname !== '/') return null;
  if (parsed.search || parsed.hash) return null;

  const candidate = normalizeApiBase(`${parsed.protocol}//${parsed.host}`);
  if (allowed.has(candidate)) return candidate;

  if (allowLocalhost && /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) {
    return candidate;
  }

  return null;
}
