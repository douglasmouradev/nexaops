import { Request, Response, NextFunction } from 'express';
import { resolveAgentAuth } from '../lib/agent-credentials.js';

export interface AgentAuthRequest extends Request {
  agent?: {
    agentId: string;
    deviceId: string;
    organizationId: string;
  };
}

function extractAgentToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const header = req.headers['x-agent-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (typeof req.body?.token === 'string' && req.body.token.trim()) return req.body.token.trim();
  return undefined;
}

function extractAgentId(req: Request): string | undefined {
  const header = req.headers['x-agent-id'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (typeof req.body?.agentId === 'string' && req.body.agentId.trim()) return req.body.agentId.trim();
  if (typeof req.query?.agentId === 'string' && req.query.agentId.trim()) return req.query.agentId.trim();
  return undefined;
}

/**
 * Exige token do agent (Bearer / X-Agent-Token) + agentId.
 * Aceita device.agentAuthToken ou agentToken da org (legado).
 */
export async function authenticateAgent(
  req: AgentAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractAgentToken(req);
    const agentId = extractAgentId(req);

    if (!token) {
      res.status(401).json({ success: false, error: 'Token do agente é obrigatório (Authorization: Bearer)' });
      return;
    }
    if (!agentId) {
      res.status(401).json({ success: false, error: 'agentId é obrigatório' });
      return;
    }

    const creds = await resolveAgentAuth(token, agentId);
    if (!creds) {
      res.status(401).json({ success: false, error: 'Agente não autenticado' });
      return;
    }

    req.agent = {
      agentId: creds.agentId,
      deviceId: creds.deviceId,
      organizationId: creds.organizationId,
    };
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}
