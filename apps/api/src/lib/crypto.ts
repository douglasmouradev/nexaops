import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Deriva chave de 32 bytes via scrypt a partir de VAULT_ENCRYPTION_KEY.
 * Mantém compatibilidade com blobs antigos (UTF-8 slice) via decryptWithFallback.
 */
function getKeyScrypt(): Buffer {
  const key = process.env.VAULT_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'VAULT_ENCRYPTION_KEY não configurada (mínimo 32 caracteres). Defina no .env'
    );
  }
  return crypto.scryptSync(key, 'nexaops-vault-v1', 32);
}

function getKeyLegacy(): Buffer {
  const key = process.env.VAULT_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'VAULT_ENCRYPTION_KEY não configurada (mínimo 32 caracteres). Defina no .env'
    );
  }
  return Buffer.from(key.slice(0, 32), 'utf8');
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKeyScrypt(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  // prefixo v1 = scrypt
  return `v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  if (encryptedText.startsWith('v1:')) {
    const [, ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKeyScrypt(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // legado: iv:tag:data com chave UTF-8 slice
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKeyLegacy(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // tenta scrypt sem prefixo (edge)
    const decipher = crypto.createDecipheriv(ALGORITHM, getKeyScrypt(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
