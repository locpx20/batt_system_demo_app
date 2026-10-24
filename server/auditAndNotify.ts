import type { DatabaseSync } from 'node:sqlite';
import { RoleCode } from '../shared/types.ts';

export function writeAuditLog(
  db: DatabaseSync,
  params: {
    entityType: string;
    entityId: number;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    reason?: string | null;
    referenceCode?: string | null;
    actorId: number;
    createdAt?: string;
  }
): void {
  const ts = params.createdAt || new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_logs (entity_type, entity_id, action, from_status, to_status, reason, reference_code, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.entityType,
    params.entityId,
    params.action,
    params.fromStatus ?? null,
    params.toStatus ?? null,
    params.reason ?? null,
    params.referenceCode ?? null,
    params.actorId,
    ts
  );
}

export function notifyUser(
  db: DatabaseSync,
  params: {
    userId: number;
    dedupKey: string;
    title: string;
    message: string;
    targetPath: string;
    referenceCode?: string | null;
  }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO notifications (user_id, dedup_key, title, message, target_path, reference_code, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    params.userId,
    params.dedupKey,
    params.title,
    params.message,
    params.targetPath,
    params.referenceCode ?? null,
    new Date().toISOString()
  );
}

export function notifyRoles(
  db: DatabaseSync,
  roles: RoleCode[],
  params: {
    dedupPrefix: string;
    title: string;
    message: string;
    targetPath: string;
    referenceCode?: string | null;
    excludeUserId?: number;
  }
): void {
  if (roles.length === 0) return;
  const placeholders = roles.map(() => '?').join(',');
  const users = db
    .prepare(`SELECT id FROM users WHERE status = 'ACTIVE' AND role IN (${placeholders})`)
    .all(...roles) as Array<{ id: number }>;

  for (const u of users) {
    if (params.excludeUserId && Number(u.id) === params.excludeUserId) continue;
    notifyUser(db, {
      userId: Number(u.id),
      dedupKey: `${params.dedupPrefix}:u${u.id}`,
      title: params.title,
      message: params.message,
      targetPath: params.targetPath,
      referenceCode: params.referenceCode,
    });
  }
}

export function getEntityHistory(db: DatabaseSync, entityType: string, entityId: number) {
  return db
    .prepare(
      `SELECT a.id, a.entity_type as entityType, a.entity_id as entityId, a.action,
              a.from_status as fromStatus, a.to_status as toStatus, a.reason,
              a.reference_code as referenceCode, a.actor_id as actorId,
              u.full_name as actorName, u.role as actorRole, a.created_at as createdAt
       FROM audit_logs a
       JOIN users u ON u.id = a.actor_id
       WHERE a.entity_type = ? AND a.entity_id = ?
       ORDER BY a.id DESC`
    )
    .all(entityType, entityId);
}

export function getEntityAttachments(db: DatabaseSync, entityType: string, entityId: number) {
  return db
    .prepare(
      `SELECT att.id, att.entity_type as entityType, att.entity_id as entityId,
              att.doc_type as docType, att.file_name as fileName, att.file_url as fileUrl,
              att.mime_type as mimeType, att.file_size as fileSize,
              att.uploaded_by as uploadedBy, u.full_name as uploadedByName,
              att.created_at as createdAt
       FROM attachments att
       JOIN users u ON u.id = att.uploaded_by
       WHERE att.entity_type = ? AND att.entity_id = ?
       ORDER BY att.id DESC`
    )
    .all(entityType, entityId);
}

export function generateCode(db: DatabaseSync, table: string, prefix: string, dateStr?: string): string {
  const cleanDate = (dateStr || new Date().toISOString().slice(0, 10)).replace(/-/g, '').slice(2);
  const base = `${prefix}-${cleanDate}-`;
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE code LIKE ?`)
    .get(`${base}%`) as { cnt: number };
  const seq = String(Number(row.cnt) + 1).padStart(2, '0');
  let candidate = `${base}${seq}`;
  let bump = Number(row.cnt) + 1;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE code = ?`).get(candidate)) {
    bump += 1;
    candidate = `${base}${String(bump).padStart(2, '0')}`;
  }
  return candidate;
}

export function generateBatchCode(db: DatabaseSync, productionDate: string, shift: string): string {
  // Format: TP/YY/MM/DD-C{shiftNum}-{seq} (e.g. TP/26/10/24-C1-01)
  const parts = productionDate.split('-');
  const yy = (parts[0] || '2026').slice(-2);
  const mm = parts[1] || '01';
  const dd = parts[2] || '01';
  const shiftDigit = shift.includes('2') ? '2' : shift.includes('3') ? '3' : '1';
  const prefix = `TP/${yy}/${mm}/${dd}-C${shiftDigit}-`;
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM shift_reports WHERE batch_code LIKE ?`)
    .get(`${prefix}%`) as { cnt: number };
  let bump = Number(row.cnt) + 1;
  let candidate = `${prefix}${String(bump).padStart(2, '0')}`;
  while (db.prepare(`SELECT 1 FROM shift_reports WHERE batch_code = ?`).get(candidate)) {
    bump += 1;
    candidate = `${prefix}${String(bump).padStart(2, '0')}`;
  }
  return candidate;
}
