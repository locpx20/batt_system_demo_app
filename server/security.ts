import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from './db.ts';
import { RoleCode, type AuthUser } from '../shared/types.ts';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const keyBuf = Buffer.from(key, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

export function createSessionToken(userId: number): string {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 12).toISOString();
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(token, userId, expiresAt, now.toISOString());
  return token;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  token?: string;
}

export function mapUserRow(row: Record<string, unknown>): AuthUser {
  return {
    id: Number(row.id),
    username: String(row.username),
    fullName: String(row.full_name),
    role: String(row.role) as RoleCode,
    phone: String(row.phone || ''),
    email: String(row.email || ''),
    status: String(row.status) === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    createdAt: String(row.created_at),
    isDemo: Number(row.is_demo) === 1,
  };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.' });
    return;
  }

  const db = getDb();
  const session = db
    .prepare(
      `SELECT s.token, s.expires_at, u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as Record<string, unknown> | undefined;

  if (!session) {
    res.status(401).json({ error: 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.' });
    return;
  }

  if (new Date(String(session.expires_at)).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    res.status(401).json({ error: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.' });
    return;
  }

  if (String(session.status) !== 'ACTIVE') {
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(Number(session.id));
    res.status(403).json({ error: 'Tài khoản đã ngừng sử dụng. Vui lòng liên hệ Quản trị hệ thống.' });
    return;
  }

  req.user = mapUserRow(session);
  req.token = token;
  next();
}

export function requireRoles(...allowedRoles: RoleCode[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Vui lòng đăng nhập để thực hiện thao tác.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Bạn không có quyền thực hiện thao tác này.',
      });
      return;
    }
    next();
  };
}
