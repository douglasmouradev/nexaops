import fs from 'fs';
import path from 'path';

const MSI_NAME = 'NexaOpsAgent.msi';

export function resolveAgentMsiPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'apps/agent/installer/dist', MSI_NAME),
    path.join(process.cwd(), 'apps', 'agent', 'installer', 'dist', MSI_NAME),
    path.join(process.cwd(), '../agent/installer/dist', MSI_NAME),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function isAgentMsiBuilt(): boolean {
  return resolveAgentMsiPath() !== null;
}
