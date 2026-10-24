import { Router } from 'express';
import { getDb, withTransaction } from '../db.ts';
import {
  createSessionToken,
  hashPassword,
  mapUserRow,
  requireAuth,
  requireRoles,
  verifyPassword,
  type AuthedRequest,
} from '../security.ts';
import { writeAuditLog } from '../auditAndNotify.ts';
import { RoleCode } from '../../shared/types.ts';

export const authAndUsersRouter = Router();

authAndUsersRouter.post('/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.' });
    return;
  }

  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM users WHERE LOWER(username) = LOWER(?)`)
    .get(username) as Record<string, unknown> | undefined;

  if (!row || !verifyPassword(password, String(row.password_hash))) {
    res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    return;
  }

  if (String(row.status) !== 'ACTIVE') {
    res.status(403).json({
      error: 'Tài khoản này đã ngừng sử dụng. Vui lòng liên hệ Quản trị hệ thống.',
    });
    return;
  }

  const token = createSessionToken(Number(row.id));
  res.json({
    token,
    user: mapUserRow(row),
  });
});

authAndUsersRouter.post('/auth/google-session', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'Không xác định được email Google đã xác thực.' });
    return;
  }
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM users WHERE LOWER(email) = ?`)
    .get(email) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(403).json({
      error: 'Email Google này chưa được gán tài khoản nội bộ trong BATT PPMS.',
    });
    return;
  }
  if (String(row.status) !== 'ACTIVE') {
    res.status(403).json({
      error: 'Tài khoản nội bộ liên kết đã ngừng sử dụng.',
    });
    return;
  }
  const token = createSessionToken(Number(row.id));
  res.json({
    token,
    user: mapUserRow(row),
  });
});

authAndUsersRouter.post('/auth/forgot-password', (req, res) => {
  const username = String(req.body?.username || '').trim();
  if (!username) {
    res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập cần hỗ trợ.' });
    return;
  }
  // Honest operational response: no fake email/SMS sending
  res.json({
    supportedByAdminOnly: true,
    message:
      'Hệ thống nội bộ không gửi mã tự động qua email hoặc SMS. Vui lòng liên hệ Quản trị hệ thống để được cấp lại mật khẩu trực tiếp.',
  });
});

authAndUsersRouter.post('/auth/logout', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  if (req.token) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(req.token);
  }
  res.json({ message: 'Đã đăng xuất khỏi hệ thống.' });
});

authAndUsersRouter.get('/auth/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

authAndUsersRouter.put('/auth/profile', requireAuth, (req: AuthedRequest, res) => {
  const fullName = String(req.body?.fullName || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const email = String(req.body?.email || '').trim();

  if (!fullName) {
    res.status(400).json({ error: 'Họ tên không được để trống.' });
    return;
  }
  if (req.body?.role !== undefined && req.body.role !== req.user!.role) {
    res.status(403).json({ error: 'Người dùng không được phép tự thay đổi vai trò nghiệp vụ.' });
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users SET full_name = ?, phone = ?, email = ?, updated_at = ? WHERE id = ?`
  ).run(fullName, phone, email, now, req.user!.id);

  const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id) as Record<
    string,
    unknown
  >;
  res.json({
    message: 'Đã cập nhật thông tin cá nhân.',
    user: mapUserRow(updated),
  });
});

authAndUsersRouter.put('/auth/password', requireAuth, (req: AuthedRequest, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.' });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: 'Mật khẩu mới cần có ít nhất 6 ký tự.' });
    return;
  }

  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id) as Record<
    string,
    unknown
  >;
  if (!verifyPassword(currentPassword, String(row.password_hash))) {
    res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.' });
    return;
  }

  const newHash = hashPassword(newPassword);
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
    newHash,
    new Date().toISOString(),
    req.user!.id
  );
  res.json({ message: 'Đã đổi mật khẩu thành công.' });
});

// Operational lookup options for authorized roles (Manager, Warehouse Keeper, Staff, Maintenance, Owner)
authAndUsersRouter.get(
  '/directory/options',
  requireAuth,
  requireRoles(
    RoleCode.OWNER,
    RoleCode.MANAGER,
    RoleCode.WAREHOUSE_KEEPER,
    RoleCode.STAFF,
    RoleCode.MAINTENANCE_STAFF,
    RoleCode.QC_STAFF,
    RoleCode.PURCHASING_STAFF
  ),
  (_req, res) => {
    const db = getDb();
    const staffList = db
      .prepare(
        `SELECT id, full_name as fullName, role, username
         FROM users
         WHERE status = 'ACTIVE' AND role IN ('STAFF', 'PURCHASING_STAFF', 'MAINTENANCE_STAFF', 'WAREHOUSE_KEEPER', 'QC_STAFF', 'MANAGER')
         ORDER BY full_name ASC`
      )
      .all();
    const machines = db
      .prepare(`SELECT id, code, name, area, status, is_demo as isDemo FROM machines ORDER BY code ASC`)
      .all();
    res.json({ staffList, machines });
  }
);

// ADMIN_SYSTEM User Management
authAndUsersRouter.get(
  '/users',
  requireAuth,
  requireRoles(RoleCode.ADMIN_SYSTEM),
  (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const role = String(req.query.role || '').trim();
    const status = String(req.query.status || '').trim();

    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM users ORDER BY id ASC`)
      .all() as Array<Record<string, unknown>>;

    const allMapped = rows.map(mapUserRow);
    const summary = {
      total: allMapped.length,
      active: allMapped.filter((u) => u.status === 'ACTIVE').length,
      inactive: allMapped.filter((u) => u.status === 'INACTIVE').length,
    };

    const filtered = allMapped.filter((u) => {
      if (role && u.role !== role) return false;
      if (status && u.status !== status) return false;
      if (
        search &&
        !u.fullName.toLowerCase().includes(search) &&
        !u.username.toLowerCase().includes(search)
      ) {
        return false;
      }
      return true;
    });

    res.json({ summary, items: filtered });
  }
);

const VALID_ROLES = new Set<string>(Object.values(RoleCode));

authAndUsersRouter.post(
  '/users',
  requireAuth,
  requireRoles(RoleCode.ADMIN_SYSTEM),
  (req: AuthedRequest, res) => {
    const fullName = String(req.body?.fullName || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    const role = String(req.body?.role || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const email = String(req.body?.email || '').trim();
    const status = String(req.body?.status || 'ACTIVE').trim() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

    if (!fullName || !username || !password || !role) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ họ tên, tên đăng nhập, mật khẩu và vai trò.' });
      return;
    }
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
      res.status(400).json({
        error: 'Tên đăng nhập gồm 3–40 ký tự chữ không dấu, số, dấu chấm hoặc gạch dưới.',
      });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Mật khẩu khởi tạo cần ít nhất 6 ký tự.' });
      return;
    }
    if (!VALID_ROLES.has(role)) {
      res.status(400).json({ error: 'Vai trò nghiệp vụ không hợp lệ.' });
      return;
    }

    try {
      const created = withTransaction((db) => {
        const dup = db
          .prepare(`SELECT id FROM users WHERE LOWER(username) = LOWER(?)`)
          .get(username);
        if (dup) {
          throw new Error('DUPLICATE_USERNAME');
        }
        const now = new Date().toISOString();
        const result = db
          .prepare(
            `INSERT INTO users (username, password_hash, full_name, role, phone, email, status, is_demo, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
          )
          .run(username, hashPassword(password), fullName, role, phone, email, status, now, now);
        const newId = Number(result.lastInsertRowid);
        writeAuditLog(db, {
          entityType: 'USER',
          entityId: newId,
          action: 'Tạo tài khoản mới',
          fromStatus: null,
          toStatus: status,
          referenceCode: username,
          actorId: req.user!.id,
          createdAt: now,
        });
        return db.prepare(`SELECT * FROM users WHERE id = ?`).get(newId) as Record<string, unknown>;
      });

      res.status(201).json({
        message: 'Đã tạo tài khoản người dùng mới.',
        user: mapUserRow(created),
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_USERNAME') {
        res.status(409).json({ error: 'Tên đăng nhập đã tồn tại. Vui lòng chọn tên khác.' });
        return;
      }
      res.status(500).json({ error: 'Không thể tạo tài khoản. Vui lòng thử lại.' });
    }
  }
);

authAndUsersRouter.put(
  '/users/:id',
  requireAuth,
  requireRoles(RoleCode.ADMIN_SYSTEM),
  (req: AuthedRequest, res) => {
    const targetId = Number(req.params.id);
    const fullName = String(req.body?.fullName || '').trim();
    const role = String(req.body?.role || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const email = String(req.body?.email || '').trim();
    const status = String(req.body?.status || '').trim() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const resetPassword = String(req.body?.resetPassword || '').trim();

    if (!targetId || !fullName || !VALID_ROLES.has(role)) {
      res.status(400).json({ error: 'Thông tin cập nhật tài khoản không hợp lệ.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM users WHERE id = ?`).get(targetId) as
      | Record<string, unknown>
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
      return;
    }

    // Rule: Account cannot self-escalate or self-modify role or deactivate self
    if (targetId === req.user!.id) {
      if (role !== String(existing.role)) {
        res.status(403).json({ error: 'Không được phép tự thay đổi vai trò của chính mình.' });
        return;
      }
      if (status !== 'ACTIVE') {
        res.status(400).json({ error: 'Không thể tự ngừng sử dụng tài khoản đang đăng nhập.' });
        return;
      }
    }

    if (resetPassword && resetPassword.length < 6) {
      res.status(400).json({ error: 'Mật khẩu cấp lại cần ít nhất 6 ký tự.' });
      return;
    }

    const updated = withTransaction((txDb) => {
      const now = new Date().toISOString();
      if (resetPassword) {
        txDb
          .prepare(
            `UPDATE users
             SET full_name = ?, role = ?, phone = ?, email = ?, status = ?, password_hash = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(fullName, role, phone, email, status, hashPassword(resetPassword), now, targetId);
      } else {
        txDb
          .prepare(
            `UPDATE users
             SET full_name = ?, role = ?, phone = ?, email = ?, status = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(fullName, role, phone, email, status, now, targetId);
      }

      if (status === 'INACTIVE') {
        txDb.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(targetId);
      }

      writeAuditLog(txDb, {
        entityType: 'USER',
        entityId: targetId,
        action:
          String(existing.role) !== role
            ? `Cập nhật vai trò (${existing.role} -> ${role})`
            : 'Cập nhật thông tin tài khoản',
        fromStatus: String(existing.status),
        toStatus: status,
        referenceCode: String(existing.username),
        actorId: req.user!.id,
        createdAt: now,
      });

      return txDb.prepare(`SELECT * FROM users WHERE id = ?`).get(targetId) as Record<
        string,
        unknown
      >;
    });

    res.json({
      message: 'Đã lưu thay đổi tài khoản.',
      user: mapUserRow(updated),
    });
  }
);
