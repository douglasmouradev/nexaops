import { z } from 'zod';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const UserRole = z.enum(['ADMIN', 'TECHNICIAN', 'READ_ONLY']);
export type UserRole = z.infer<typeof UserRole>;

export const DeviceType = z.enum(['PC', 'SERVER', 'MOBILE', 'NETWORK']);
export type DeviceType = z.infer<typeof DeviceType>;

export const DeviceStatus = z.enum(['ONLINE', 'OFFLINE', 'UNKNOWN']);
export type DeviceStatus = z.infer<typeof DeviceStatus>;

export const AlertSeverity = z.enum(['CRITICAL', 'WARNING', 'INFO']);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

export const AlertStatus = z.enum(['NEW', 'ACKNOWLEDGED', 'RESOLVED']);
export type AlertStatus = z.infer<typeof AlertStatus>;

export const TicketStatus = z.enum(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const TicketPriority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export type TicketPriority = z.infer<typeof TicketPriority>;

export const ScriptLanguage = z.enum(['POWERSHELL', 'BASH']);
export type ScriptLanguage = z.infer<typeof ScriptLanguage>;

export const ExecutionStatus = z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED']);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

export const PatchStatus = z.enum(['PENDING', 'SCHEDULED', 'INSTALLED', 'FAILED']);
export type PatchStatus = z.infer<typeof PatchStatus>;

export const OSType = z.enum(['WINDOWS', 'MACOS', 'LINUX']);
export type OSType = z.infer<typeof OSType>;

export const CommentType = z.enum(['INTERNAL', 'CUSTOMER']);
export type CommentType = z.infer<typeof CommentType>;

export const ScanStatus = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']);
export type ScanStatus = z.infer<typeof ScanStatus>;

export const AssetType = z.enum(['HARDWARE', 'SOFTWARE', 'LICENSE']);
export type AssetType = z.infer<typeof AssetType>;

export const ArticleVisibility = z.enum(['INTERNAL', 'PUBLIC']);
export type ArticleVisibility = z.infer<typeof ArticleVisibility>;

export const ReferralStatus = z.enum(['SENT', 'REGISTERED', 'CONVERTED']);
export type ReferralStatus = z.infer<typeof ReferralStatus>;

export const RemoteSessionStatus = z.enum(['PENDING', 'CONNECTED', 'DISCONNECTED']);
export type RemoteSessionStatus = z.infer<typeof RemoteSessionStatus>;

// ─── Auth ────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  totpCode: z.string().length(6).optional(),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  organizationName: z.string().min(2),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export const inviteUserSchema = z.object({
  email: z.string().email(),
  role: UserRole,
  name: z.string().min(2),
});

export const enable2FASchema = z.object({
  totpCode: z.string().length(6),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

// ─── Devices ─────────────────────────────────────────────────────────────────

export const createDeviceSchema = z.object({
  name: z.string().min(1),
  hostname: z.string().optional(),
  type: DeviceType,
  siteId: z.string().optional(),
  folder: z.string().optional(),
  osType: OSType.optional(),
  osVersion: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateDeviceSchema = createDeviceSchema.partial();

export const deviceFilterSchema = z.object({
  search: z.string().optional(),
  nlFilter: z.string().optional(),
  siteId: z.string().optional(),
  type: DeviceType.optional(),
  status: DeviceStatus.optional(),
  favorites: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  folder: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const bulkDeviceActionSchema = z.object({
  deviceIds: z.array(z.string()).min(1),
  action: z.enum(['RUN_SCRIPT', 'ASSIGN_AUTOMATION', 'INSTALL_SOFTWARE', 'ASSIGN_THRESHOLD', 'DELETE']),
  payload: z.record(z.unknown()).optional(),
});

export const agentInstallSchema = z.object({
  osType: OSType,
  siteId: z.string().optional(),
  folder: z.string().optional(),
});

// ─── Sites ───────────────────────────────────────────────────────────────────

export const createSiteSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  notes: z.string().optional(),
});

export const updateSiteSchema = createSiteSchema.partial();

// ─── Alerts ──────────────────────────────────────────────────────────────────

export const createAlertRuleSchema = z.object({
  name: z.string().min(1),
  metric: z.enum(['CPU', 'RAM', 'DISK', 'SERVICE', 'OFFLINE']),
  threshold: z.number().optional(),
  durationMinutes: z.number().int().optional(),
  severity: AlertSeverity,
  enabled: z.boolean().default(true),
});

export const updateAlertStatusSchema = z.object({
  status: AlertStatus,
});

// ─── Tickets ─────────────────────────────────────────────────────────────────

export const createTicketSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: TicketPriority.default('MEDIUM'),
  siteId: z.string().optional(),
  deviceId: z.string().optional(),
  assigneeId: z.string().optional(),
  alertId: z.string().optional(),
});

export const updateTicketSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: TicketStatus.optional(),
  priority: TicketPriority.optional(),
  assigneeId: z.string().nullable().optional(),
});

export const createCommentSchema = z.object({
  content: z.string().min(1),
  type: CommentType.default('INTERNAL'),
});

// ─── Scripts ─────────────────────────────────────────────────────────────────

export const createScriptSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  language: ScriptLanguage,
  content: z.string().min(1),
  category: z.string().optional(),
  requiresApproval: z.boolean().optional().default(false),
});

export const runScriptSchema = z.object({
  scriptId: z.string(),
  deviceIds: z.array(z.string()).min(1),
});

// ─── Patches ─────────────────────────────────────────────────────────────────

export const schedulePatchSchema = z.object({
  patchIds: z.array(z.string()).min(1),
  scheduledAt: z.string().datetime(),
  maintenanceWindow: z.string().optional(),
});

// ─── Knowledge Base ──────────────────────────────────────────────────────────

export const createArticleSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.string().optional(),
  visibility: ArticleVisibility.default('INTERNAL'),
  tags: z.array(z.string()).optional(),
});

// ─── Assets ──────────────────────────────────────────────────────────────────

export const createAssetSchema = z.object({
  name: z.string().min(1),
  type: AssetType.default('HARDWARE'),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  purchaseDate: z.string().datetime().optional(),
  warrantyEnd: z.string().datetime().optional(),
  licenseKey: z.string().optional(),
  siteId: z.string().optional(),
});

// ─── Contracts / Finance ─────────────────────────────────────────────────────

export const createContractSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().datetime().or(z.string().min(1)),
  endDate: z.string().datetime().or(z.string().min(1)).optional().nullable(),
  value: z.number().optional().nullable(),
  currency: z.string().default('BRL'),
  status: z.string().default('ACTIVE'),
  siteId: z.string().min(1),
});

export const updateContractSchema = createContractSchema.partial();

// ─── Billing / Automations / Agent ───────────────────────────────────────────

export const createTimeEntrySchema = z.object({
  description: z.string().min(1),
  hours: z.coerce.number().positive(),
  billable: z.boolean().optional(),
  hourlyRate: z.coerce.number().nonnegative().optional().nullable(),
  workedAt: z.string().datetime().or(z.string().min(1)).optional(),
  ticketId: z.string().optional().nullable(),
  siteId: z.string().optional().nullable(),
});

export const createInvoiceSchema = z.object({
  currency: z.string().optional(),
  notes: z.string().optional().nullable(),
  siteId: z.string().optional().nullable(),
  dueDate: z.string().datetime().or(z.string().min(1)).optional().nullable(),
  lines: z
    .array(
      z.object({
        description: z.string().optional(),
        quantity: z.coerce.number().optional(),
        unitPrice: z.coerce.number().optional(),
      })
    )
    .min(1),
});

export const createAutomationSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  trigger: z.string().min(1),
  action: z.string().min(1),
  triggerConfig: z.record(z.unknown()).optional(),
  actionConfig: z.record(z.unknown()).optional(),
  scriptId: z.string().optional().nullable(),
  siteId: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const agentMetricsSchema = z.object({
  cpuPercent: z.coerce.number().min(0).max(100),
  ramPercent: z.coerce.number().min(0).max(100),
  diskPercent: z.coerce.number().min(0).max(100),
  rebootPending: z.boolean().optional(),
});

// ─── Threshold Profiles ──────────────────────────────────────────────────────

export const createThresholdProfileSchema = z.object({
  name: z.string().min(1),
  cpuThreshold: z.number().min(0).max(100).optional(),
  ramThreshold: z.number().min(0).max(100).optional(),
  diskThreshold: z.number().min(0).max(100).optional(),
  offlineMinutes: z.number().int().min(1).optional(),
});

// ─── Pagination Response ─────────────────────────────────────────────────────

export const paginationMetaSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

// ─── API Response wrappers ───────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: PaginationMeta;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  twoFactorEnabled: boolean;
  /** Org exige 2FA e usuário ainda não ativou */
  mustEnable2FA?: boolean;
  notifyCriticalAlerts?: boolean;
  /** CSV: CRITICAL,WARNING,INFO */
  notifyAlertSeverities?: string;
}

// ─── Natural language filter parser (simple mock) ────────────────────────────

export interface ParsedNLFilter {
  status?: DeviceStatus;
  type?: DeviceType;
  search?: string;
  offline?: boolean;
  hasAlerts?: boolean;
  hasPatches?: boolean;
  rebootPending?: boolean;
}

export function parseNaturalLanguageFilter(query: string): ParsedNLFilter {
  const lower = query.toLowerCase();
  const result: ParsedNLFilter = {};

  if (lower.includes('offline') || lower.includes('desligado') || lower.includes('inativo')) {
    result.status = 'OFFLINE';
    result.offline = true;
  }
  if (lower.includes('online') || lower.includes('ativo') || lower.includes('ligado')) {
    result.status = 'ONLINE';
  }
  if (lower.includes('servidor') || lower.includes('server')) {
    result.type = 'SERVER';
  }
  if (lower.includes('pc') || lower.includes('workstation') || lower.includes('desktop')) {
    result.type = 'PC';
  }
  if (lower.includes('mobile') || lower.includes('celular')) {
    result.type = 'MOBILE';
  }
  if (lower.includes('rede') || lower.includes('network') || lower.includes('switch') || lower.includes('router')) {
    result.type = 'NETWORK';
  }
  if (lower.includes('alerta') || lower.includes('alert')) {
    result.hasAlerts = true;
  }
  if (lower.includes('patch') || lower.includes('atualização') || lower.includes('atualizacao')) {
    result.hasPatches = true;
  }
  if (lower.includes('reinício') || lower.includes('reinicio') || lower.includes('reboot')) {
    result.rebootPending = true;
  }

  const quoted = query.match(/"([^"]+)"/);
  if (quoted) {
    result.search = quoted[1];
  }

  return result;
}
