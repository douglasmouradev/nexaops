import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const START_NUMBER = 1001;
const MAX_RETRIES = 5;

export interface CreateTicketInput {
  organizationId: string;
  creatorId: string;
  title: string;
  description?: string | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  siteId?: string | null;
  deviceId?: string | null;
  assigneeId?: string | null;
  contactEmail?: string | null;
  slaHours?: number;
}

async function nextTicketNumber(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<number> {
  const last = await tx.ticket.findFirst({
    where: { organizationId },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  return last ? last.number + 1 : START_NUMBER;
}

/**
 * Cria ticket com número sequencial por organização.
 * Usa unique (organizationId, number) + retry em race condition (P2002).
 */
export async function createTicket(input: CreateTicketInput) {
  const slaHours = input.slaHours ?? 24;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const number = await nextTicketNumber(tx, input.organizationId);
        return tx.ticket.create({
          data: {
            number,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority ?? 'MEDIUM',
            siteId: input.siteId ?? null,
            deviceId: input.deviceId ?? null,
            assigneeId: input.assigneeId ?? null,
            creatorId: input.creatorId,
            organizationId: input.organizationId,
            contactEmail: input.contactEmail ?? null,
            slaDeadline: new Date(Date.now() + slaHours * 60 * 60 * 1000),
          },
        });
      });
    } catch (err) {
      lastError = err;
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Não foi possível alocar número de ticket');
}
