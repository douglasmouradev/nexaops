import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { logger } from './logger.js';

let transporter: nodemailer.Transporter | null = null;
let lastVerify: { ok: boolean; at: string; error?: string } | null = null;

function buildTransport(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  const options: SMTPTransport.Options = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth:
      process.env.SMTP_USER || process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
  };
  return nodemailer.createTransport(options);
}

transporter = buildTransport();

export function getSmtpStatus(): {
  configured: boolean;
  required: boolean;
  lastVerify: typeof lastVerify;
} {
  return {
    configured: Boolean(process.env.SMTP_HOST),
    required: process.env.SMTP_REQUIRED === 'true',
    lastVerify,
  };
}

export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  if (!transporter) {
    lastVerify = {
      ok: false,
      at: new Date().toISOString(),
      error: 'SMTP_HOST não configurado',
    };
    return { ok: false, error: lastVerify.error };
  }
  try {
    await transporter.verify();
    lastVerify = { ok: true, at: new Date().toISOString() };
    return { ok: true };
  } catch (err) {
    lastVerify = {
      ok: false,
      at: new Date().toISOString(),
      error: (err as Error).message,
    };
    return { ok: false, error: lastVerify.error };
  }
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!transporter) {
    if (process.env.SMTP_REQUIRED === 'true' && process.env.NODE_ENV === 'production') {
      throw new Error('SMTP obrigatório em produção (SMTP_HOST / SMTP_REQUIRED)');
    }
    // Nunca logar HTML/corpo — contém tokens de reset/convite
    logger.info('email_console_fallback', {
      to,
      subject,
      bodyOmitted: true,
      htmlBytes: Buffer.byteLength(html, 'utf8'),
    });
    if (process.env.EMAIL_DEV_LOG_BODY === 'true') {
      logger.warn('email_dev_body_enabled', {
        note: 'EMAIL_DEV_LOG_BODY=true — corpo omitido do log por segurança; use SMTP real ou revise o fluxo no painel',
      });
    }
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@nexaops.local',
      to,
      subject,
      html,
    });
  } catch (err) {
    logger.error('email_send_failed', { to, subject, error: (err as Error).message });
    throw err;
  }
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const url = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/reset-password?token=${token}`;
  await sendEmail(
    email,
    'Redefinir senha - NexaOps',
    `<p>Clique para redefinir sua senha:</p><p><a href="${url}">${url}</a></p><p>Válido por 1 hora.</p>`
  );
}

export async function sendInviteEmail(email: string, name: string, token: string, orgName: string): Promise<void> {
  const url = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/accept-invite?token=${token}`;
  await sendEmail(
    email,
    `Convite para ${orgName} - NexaOps`,
    `<p>Olá ${name},</p><p>Você foi convidado para ${orgName}.</p><p><a href="${url}">Aceitar convite</a></p>`
  );
}
