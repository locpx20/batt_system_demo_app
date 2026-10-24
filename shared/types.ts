export const RoleCode = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  PURCHASING_STAFF: 'PURCHASING_STAFF',
  WAREHOUSE_KEEPER: 'WAREHOUSE_KEEPER',
  STAFF: 'STAFF',
  QC_STAFF: 'QC_STAFF',
  MAINTENANCE_STAFF: 'MAINTENANCE_STAFF',
  ADMIN_SYSTEM: 'ADMIN_SYSTEM',
} as const;

export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];

export const ROLE_LABELS: Record<RoleCode, string> = {
  [RoleCode.OWNER]: 'Chủ doanh nghiệp',
  [RoleCode.MANAGER]: 'Quản lý xưởng',
  [RoleCode.PURCHASING_STAFF]: 'Nhân viên thu mua',
  [RoleCode.WAREHOUSE_KEEPER]: 'Thủ kho',
  [RoleCode.STAFF]: 'Công nhân',
  [RoleCode.QC_STAFF]: 'Nhân viên QC',
  [RoleCode.MAINTENANCE_STAFF]: 'Nhân viên bảo trì',
  [RoleCode.ADMIN_SYSTEM]: 'Quản trị hệ thống',
};

export type AccountStatus = 'ACTIVE' | 'INACTIVE';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: RoleCode;
  phone: string;
  email: string;
  status: AccountStatus;
  createdAt: string;
  isDemo: boolean;
}

export interface AttachmentItem {
  id: number;
  entityType: string;
  entityId: number;
  docType: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: number;
  uploadedByName: string;
  createdAt: string;
}

export interface AuditHistoryItem {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  referenceCode: string | null;
  actorId: number;
  actorName: string;
  actorRole: RoleCode;
  createdAt: string;
}

export interface NotificationItem {
  id: number;
  userId: number;
  title: string;
  message: string;
  targetPath: string;
  referenceCode: string | null;
  isRead: boolean;
  createdAt: string;
}
