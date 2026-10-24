import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { getDb, getUploadsDir, withTransaction } from '../db.ts';
import { requireAuth, requireRoles, type AuthedRequest } from '../security.ts';
import { writeAuditLog } from '../auditAndNotify.ts';
import { RoleCode } from '../../shared/types.ts';

export const financeReportsUploadsRouter = Router();

// ==================== FILE UPLOADS (STRICT VALIDATION) ====================
const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadsDir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.pdf'].includes(ext)
      ? ext
      : '.bin';
    cb(null, `att_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${safeExt}`);
  },
});

const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error('INVALID_FILE_TYPE'));
      return;
    }
    cb(null, true);
  },
});

financeReportsUploadsRouter.post('/uploads', requireAuth, (req: AuthedRequest, res) => {
  uploadMiddleware.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Kích thước tệp vượt giới hạn tối đa 5 MB.' });
        return;
      }
      res.status(400).json({
        error: 'Định dạng tệp không hợp lệ. Chỉ chấp nhận ảnh JPG, PNG, WEBP, SVG hoặc PDF.',
      });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Không nhận được tệp tải lên.' });
      return;
    }
    res.status(201).json({
      fileName: req.file.originalname,
      fileUrl: `/uploads/${req.file.filename}`,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
    });
  });
});

financeReportsUploadsRouter.post('/attachments', requireAuth, (req: AuthedRequest, res) => {
  const entityType = String(req.body?.entityType || '').trim();
  const entityId = Number(req.body?.entityId);
  const docType = String(req.body?.docType || 'Chứng từ đính kèm').trim();
  const fileName = String(req.body?.fileName || '').trim();
  const fileUrl = String(req.body?.fileUrl || '').trim();
  const mimeType = String(req.body?.mimeType || 'image/jpeg').trim();
  const fileSize = Number(req.body?.fileSize || 0);

  if (!entityType || !entityId || !fileName || !fileUrl) {
    res.status(400).json({ error: 'Thiếu thông tin liên kết chứng từ.' });
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(entityType, entityId, docType, fileName, fileUrl, mimeType, fileSize, req.user!.id, now);

  res.status(201).json({
    id: Number(info.lastInsertRowid),
    message: 'Đã lưu chứng từ đính kèm.',
  });
});

// ==================== NOTIFICATIONS ====================
financeReportsUploadsRouter.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, user_id as userId, title, message, target_path as targetPath,
              reference_code as referenceCode, is_read as isRead, created_at as createdAt
       FROM notifications
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 40`
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  const items = rows.map((r) => ({
    id: Number(r.id),
    userId: Number(r.userId),
    title: String(r.title),
    message: String(r.message),
    targetPath: String(r.targetPath),
    referenceCode: r.referenceCode ? String(r.referenceCode) : null,
    isRead: Number(r.isRead) === 1,
    createdAt: String(r.createdAt),
  }));

  const unreadCount = items.filter((n) => !n.isRead).length;
  res.json({ unreadCount, items });
});

financeReportsUploadsRouter.post(
  '/notifications/:id/read',
  requireAuth,
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(
      id,
      req.user!.id
    );
    res.json({ ok: true });
  }
);

financeReportsUploadsRouter.post(
  '/notifications/read-all',
  requireAuth,
  (req: AuthedRequest, res) => {
    const db = getDb();
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.user!.id);
    res.json({ ok: true });
  }
);

// ==================== ROLE-SCOPED COMPACT DASHBOARDS ====================
financeReportsUploadsRouter.get('/dashboard', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const role = req.user!.role;
  const userId = req.user!.id;
  const today = new Date().toISOString().slice(0, 10);

  if (role === RoleCode.OWNER) {
    const nvlStock = Number(
      (
        db
          .prepare(`SELECT balance_kg FROM raw_material_stock WHERE material_code = 'NVL'`)
          .get() as { balance_kg: number }
      )?.balance_kg || 0
    );
    const fgStock = Number(
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(available_kg), 0) as v FROM finished_batches WHERE warehouse_status = 'IN_STOCK'`
          )
          .get() as { v: number }
      ).v
    );
    const pendingPoCount = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM purchasing_orders WHERE status = 'PENDING_APPROVAL'`)
          .get() as { c: number }
      ).c
    );
    const pendingOutboundCount = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM outbound_orders WHERE status = 'PENDING_OWNER'`)
          .get() as { c: number }
      ).c
    );
    const receivableRem = Number(
      (
        db.prepare(`SELECT COALESCE(SUM(remaining_amount), 0) as v FROM receivables`).get() as {
          v: number;
        }
      ).v
    );
    const payableRem = Number(
      (
        db.prepare(`SELECT COALESCE(SUM(remaining_amount), 0) as v FROM payables`).get() as {
          v: number;
        }
      ).v
    );

    const pendingOutbounds = db
      .prepare(
        `SELECT o.id, o.code, c.name as customerName, o.requested_kg as requestedKg,
                o.accepted_grade as acceptedGrade, o.total_value as totalValue,
                o.expected_date as expectedDate, o.status, o.is_demo as isDemo
         FROM outbound_orders o
         JOIN customers c ON c.id = o.customer_id
         WHERE o.status = 'PENDING_OWNER'
         ORDER BY o.id DESC`
      )
      .all();

    const pendingPurchasings = db
      .prepare(
        `SELECT po.id, po.code, s.name as supplierName, po.weighed_kg as weighedKg,
                po.total_amount as totalAmount, po.request_date as requestDate, po.status, po.is_demo as isDemo
         FROM purchasing_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.status = 'PENDING_APPROVAL'
         ORDER BY po.id DESC`
      )
      .all();

    const activeMaintenances = db
      .prepare(
        `SELECT mr.id, mr.code, m.name as machineName, mr.severity, mr.status, mr.created_at as createdAt, mr.is_demo as isDemo
         FROM maintenance_requests mr
         JOIN machines m ON m.id = mr.machine_id
         WHERE mr.status != 'COMPLETED'
         ORDER BY mr.id DESC LIMIT 6`
      )
      .all();

    res.json({
      role,
      cards: [
        { label: 'NVL tồn kho', value: `${nvlStock.toLocaleString('vi-VN')} kg`, path: '/ton-kho-nvl' },
        { label: 'Thành phẩm tồn kho', value: `${fgStock.toLocaleString('vi-VN')} kg`, path: '/ton-kho-thanh-pham' },
        { label: 'Yêu cầu chờ duyệt', value: `${pendingPoCount + pendingOutboundCount}`, path: '/duyet-xuat-hang' },
        { label: 'Công nợ phải thu', value: `${receivableRem.toLocaleString('vi-VN')} đ`, path: '/cong-no-phai-thu' },
        { label: 'Công nợ phải trả', value: `${payableRem.toLocaleString('vi-VN')} đ`, path: '/cong-no-phai-tra' },
      ],
      pendingOutbounds,
      pendingPurchasings,
      activeMaintenances,
    });
    return;
  }

  if (role === RoleCode.MANAGER) {
    const todayPlans = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM production_plans WHERE status IN ('PLANNED', 'RUNNING')`)
          .get() as { c: number }
      ).c
    );
    const pendingShiftReports = Number(
      (
        db.prepare(`SELECT COUNT(*) as c FROM shift_reports WHERE status = 'SUBMITTED'`).get() as {
          c: number;
        }
      ).c
    );
    const pendingPo = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM purchasing_orders WHERE status = 'PENDING_APPROVAL'`)
          .get() as { c: number }
      ).c
    );
    const openMaint = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM maintenance_requests WHERE status != 'COMPLETED'`)
          .get() as { c: number }
      ).c
    );
    const activeOutbound = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM outbound_orders WHERE status NOT IN ('DISPATCHED', 'REJECTED')`
          )
          .get() as { c: number }
      ).c
    );

    res.json({
      role,
      cards: [
        { label: 'Kế hoạch đang chạy', value: `${todayPlans}`, path: '/ke-hoach-san-xuat' },
        { label: 'Báo cáo ca chờ duyệt', value: `${pendingShiftReports}`, path: '/bao-cao-ca' },
        { label: 'Phiếu mua chờ duyệt', value: `${pendingPo}`, path: '/thu-mua' },
        { label: 'Bảo trì đang xử lý', value: `${openMaint}`, path: '/su-co-may-moc' },
        { label: 'Đơn xuất đang xử lý', value: `${activeOutbound}`, path: '/yeu-cau-xuat-hang' },
      ],
      shiftReports: db
        .prepare(
          `SELECT sr.id, sr.code, sr.batch_code as batchCode, sr.production_date as productionDate,
                  sr.shift, sr.output_kg as outputKg, sr.status, u.full_name as staffName, sr.is_demo as isDemo
           FROM shift_reports sr JOIN users u ON u.id = sr.staff_id
           WHERE sr.status = 'SUBMITTED' ORDER BY sr.id DESC`
        )
        .all(),
      purchasingQueue: db
        .prepare(
          `SELECT po.id, po.code, s.name as supplierName, po.weighed_kg as weighedKg, po.status, po.is_demo as isDemo
           FROM purchasing_orders po JOIN suppliers s ON s.id = po.supplier_id
           WHERE po.status = 'PENDING_APPROVAL' ORDER BY po.id DESC`
        )
        .all(),
      maintenanceQueue: db
        .prepare(
          `SELECT mr.id, mr.code, m.name as machineName, mr.status, u.full_name as requestedByName, mr.is_demo as isDemo
           FROM maintenance_requests mr JOIN machines m ON m.id = mr.machine_id JOIN users u ON u.id = mr.requested_by
           WHERE mr.status IN ('NEW_ISSUE', 'REPORTED') ORDER BY mr.id DESC`
        )
        .all(),
      outboundQueue: db
        .prepare(
          `SELECT o.id, o.code, c.name as customerName, o.requested_kg as requestedKg, o.status, o.is_demo as isDemo
           FROM outbound_orders o JOIN customers c ON c.id = o.customer_id
           WHERE o.status IN ('PENDING_OWNER', 'OWNER_APPROVED', 'READY_DISPATCH', 'PARTIALLY_DISPATCHED') ORDER BY o.id DESC`
        )
        .all(),
      todayDate: today,
    });
    return;
  }

  if (role === RoleCode.PURCHASING_STAFF) {
    const counts = db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'ASSIGNED' THEN 1 ELSE 0 END), 0) as assignedCnt,
          COALESCE(SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END), 0) as inProgCnt,
          COALESCE(SUM(CASE WHEN status = 'PENDING_APPROVAL' THEN 1 ELSE 0 END), 0) as submittedCnt,
          COALESCE(SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END), 0) as rejectedCnt
         FROM purchasing_orders WHERE assigned_to = ?`
      )
      .get(userId) as Record<string, unknown>;

    res.json({
      role,
      cards: [
        { label: 'Yêu cầu được giao', value: `${counts.assignedCnt}`, path: '/thu-mua' },
        { label: 'Đang thực hiện', value: `${counts.inProgCnt}`, path: '/thu-mua' },
        { label: 'Đã gửi Manager', value: `${counts.submittedCnt}`, path: '/thu-mua' },
        { label: 'Cần bổ sung thông tin', value: `${counts.rejectedCnt}`, path: '/thu-mua' },
      ],
      tasks: db
        .prepare(
          `SELECT po.id, po.code, s.name as supplierName, po.request_date as requestDate, po.status, po.reject_reason as rejectReason, po.is_demo as isDemo
           FROM purchasing_orders po JOIN suppliers s ON s.id = po.supplier_id
           WHERE po.assigned_to = ? AND po.status IN ('ASSIGNED', 'IN_PROGRESS', 'REJECTED', 'PENDING_APPROVAL')
           ORDER BY po.id DESC`
        )
        .all(userId),
    });
    return;
  }

  if (role === RoleCode.WAREHOUSE_KEEPER) {
    const pendingNvlReceipts = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM purchasing_orders WHERE status = 'APPROVED'`)
          .get() as { c: number }
      ).c
    );
    const activePlans = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM production_plans WHERE status IN ('PLANNED', 'RUNNING')`)
          .get() as { c: number }
      ).c
    );
    const pendingFgReceipts = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM finished_batches WHERE warehouse_status = 'PENDING_RECEIPT'`)
          .get() as { c: number }
      ).c
    );
    const prepOutbounds = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM outbound_orders WHERE status IN ('OWNER_APPROVED', 'READY_DISPATCH')`
          )
          .get() as { c: number }
      ).c
    );
    const partialOutbounds = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM outbound_orders WHERE status = 'PARTIALLY_DISPATCHED'`)
          .get() as { c: number }
      ).c
    );

    res.json({
      role,
      cards: [
        { label: 'Phiếu chờ nhận NVL', value: `${pendingNvlReceipts}`, path: '/nhap-kho-nvl' },
        { label: 'Kế hoạch cần cấp NVL', value: `${activePlans}`, path: '/cap-nvl' },
        { label: 'Thành phẩm chờ nhận', value: `${pendingFgReceipts}`, path: '/tiep-nhan-thanh-pham' },
        { label: 'Xuất hàng cần chuẩn bị', value: `${prepOutbounds}`, path: '/ban-giao-xuat-hang' },
        { label: 'Bàn giao đang thực hiện', value: `${partialOutbounds}`, path: '/ban-giao-xuat-hang' },
      ],
      nvlQueue: db
        .prepare(
          `SELECT po.id, po.code, s.name as supplierName, po.weighed_kg as weighedKg, po.status, po.is_demo as isDemo
           FROM purchasing_orders po JOIN suppliers s ON s.id = po.supplier_id
           WHERE po.status = 'APPROVED' ORDER BY po.id DESC`
        )
        .all(),
      fgQueue: db
        .prepare(
          `SELECT id, batch_code as batchCode, production_date as productionDate, shift, produced_kg as producedKg, grade, warehouse_status as warehouseStatus, is_demo as isDemo
           FROM finished_batches WHERE warehouse_status = 'PENDING_RECEIPT' ORDER BY id DESC`
        )
        .all(),
      dispatchQueue: db
        .prepare(
          `SELECT o.id, o.code, c.name as customerName, o.requested_kg as requestedKg, o.dispatched_kg as dispatchedKg, o.vehicle_plate as vehiclePlate, o.status, o.is_demo as isDemo
           FROM outbound_orders o JOIN customers c ON c.id = o.customer_id
           WHERE o.status IN ('OWNER_APPROVED', 'READY_DISPATCH', 'PARTIALLY_DISPATCHED') ORDER BY o.id DESC`
        )
        .all(),
    });
    return;
  }

  if (role === RoleCode.STAFF) {
    const assignedCnt = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM plan_assignments pa
             JOIN production_plans p ON p.id = pa.plan_id
             WHERE pa.staff_id = ? AND p.status IN ('PLANNED', 'RUNNING')`
          )
          .get(userId) as { c: number }
      ).c
    );
    const submittedCnt = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM shift_reports WHERE staff_id = ? AND status = 'SUBMITTED'`)
          .get(userId) as { c: number }
      ).c
    );
    const rejectedCnt = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM shift_reports WHERE staff_id = ? AND status = 'REJECTED'`)
          .get(userId) as { c: number }
      ).c
    );
    const myMaintCnt = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM maintenance_requests WHERE requested_by = ? AND status != 'COMPLETED'`)
          .get(userId) as { c: number }
      ).c
    );

    res.json({
      role,
      cards: [
        { label: 'Kế hoạch được giao', value: `${assignedCnt}`, path: '/cong-viec-phan-cong' },
        { label: 'Báo cáo ca đã gửi', value: `${submittedCnt}`, path: '/bao-cao-ca' },
        { label: 'Báo cáo cần sửa', value: `${rejectedCnt}`, path: '/bao-cao-ca' },
        { label: 'Yêu cầu bảo trì đã gửi', value: `${myMaintCnt}`, path: '/su-co-may-moc' },
      ],
      assignments: db
        .prepare(
          `SELECT p.id, p.code, p.plan_date as planDate, p.shift, p.target_kg as targetKg, p.status,
                  pa.task_role as taskRole, m.name as machineName, p.is_demo as isDemo
           FROM plan_assignments pa
           JOIN production_plans p ON p.id = pa.plan_id
           LEFT JOIN machines m ON m.id = p.machine_id
           WHERE pa.staff_id = ?
           ORDER BY p.plan_date DESC`
        )
        .all(userId),
    });
    return;
  }

  if (role === RoleCode.QC_STAFF) {
    const pendingShiftQc = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM finished_batches WHERE qc_status = 'PENDING_QC'`)
          .get() as { c: number }
      ).c
    );
    const todayInspected = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM qc_inspections WHERE inspection_type = 'SHIFT_QC' AND substr(inspected_at, 1, 10) = ?`
          )
          .get(today) as { c: number }
      ).c
    );
    const totalInspectedBatches = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM finished_batches WHERE qc_status = 'INSPECTED'`)
          .get() as { c: number }
      ).c
    );

    res.json({
      role,
      cards: [
        { label: 'Lô chờ QC theo ca', value: `${pendingShiftQc}`, path: '/kiem-tra-chat-luong' },
        { label: 'Đã kiểm tra trong ngày', value: `${todayInspected}`, path: '/kiem-tra-chat-luong' },
        { label: 'Tổng lô đã QC theo ca', value: `${totalInspectedBatches}`, path: '/ton-kho-thanh-pham' },
      ],
      shiftQcQueue: db
        .prepare(
          `SELECT fb.id, fb.batch_code as batchCode, fb.production_date as productionDate, fb.shift,
                  fb.produced_kg as producedKg, fb.qc_status as qcStatus, u.full_name as producerName, fb.is_demo as isDemo
           FROM finished_batches fb JOIN users u ON u.id = fb.producer_id
           WHERE fb.qc_status = 'PENDING_QC' ORDER BY fb.id DESC`
        )
        .all(),
      recentShiftInspections: db
        .prepare(
          `SELECT q.id, q.code, fb.batch_code as batchCode, fb.production_date as productionDate,
                  fb.shift, q.grade, q.inspection_result as status, q.is_demo as isDemo
           FROM qc_inspections q
           JOIN finished_batches fb ON fb.id = q.batch_id
           WHERE q.inspection_type = 'SHIFT_QC'
           ORDER BY q.id DESC LIMIT 8`
        )
        .all(),
    });
    return;
  }

  if (role === RoleCode.MAINTENANCE_STAFF) {
    const assigned = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM maintenance_requests WHERE assigned_to = ? AND status IN ('ASSIGNED', 'REVISION_REQUIRED')`
          )
          .get(userId) as { c: number }
      ).c
    );
    const inProgress = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM maintenance_requests WHERE assigned_to = ? AND status = 'IN_PROGRESS'`
          )
          .get(userId) as { c: number }
      ).c
    );
    const reported = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM maintenance_requests WHERE assigned_to = ? AND status = 'REPORTED'`
          )
          .get(userId) as { c: number }
      ).c
    );
    const mySpareParts = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM spare_part_requests WHERE requested_by = ?`)
          .get(userId) as { c: number }
      ).c
    );

    res.json({
      role,
      cards: [
        { label: 'Công việc được giao', value: `${assigned}`, path: '/su-co-may-moc' },
        { label: 'Đang thực hiện', value: `${inProgress}`, path: '/su-co-may-moc' },
        { label: 'Báo cáo chờ xác nhận', value: `${reported}`, path: '/su-co-may-moc' },
        { label: 'Phiếu vật tư đã gửi', value: `${mySpareParts}`, path: '/vat-tu-bao-tri' },
      ],
      tasks: db
        .prepare(
          `SELECT mr.id, mr.code, m.name as machineName, mr.severity, mr.status, mr.created_at as createdAt, mr.is_demo as isDemo
           FROM maintenance_requests mr JOIN machines m ON m.id = mr.machine_id
           WHERE mr.assigned_to = ? AND mr.status != 'COMPLETED' ORDER BY mr.id DESC`
        )
        .all(userId),
    });
    return;
  }

  // ADMIN_SYSTEM
  const totalUsers = Number(
    (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c
  );
  const activeUsers = Number(
    (db.prepare(`SELECT COUNT(*) as c FROM users WHERE status = 'ACTIVE'`).get() as { c: number }).c
  );
  res.json({
    role,
    cards: [
      { label: 'Tổng tài khoản', value: `${totalUsers}`, path: '/quan-ly-tai-khoan' },
      { label: 'Đang hoạt động', value: `${activeUsers}`, path: '/quan-ly-tai-khoan' },
      { label: 'Ngừng sử dụng', value: `${totalUsers - activeUsers}`, path: '/quan-ly-tai-khoan' },
    ],
    tasks: [],
  });
});

// ==================== PAYABLES & RECEIVABLES (OWNER ONLY) ====================
financeReportsUploadsRouter.get(
  '/finance/payables',
  requireAuth,
  requireRoles(RoleCode.OWNER),
  (req, res) => {
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT p.*, s.name as supplierName, po.code as purchasingCode, po.received_kg as receivedKg, po.unit_price as unitPrice
         FROM payables p
         JOIN suppliers s ON s.id = p.supplier_id
         JOIN purchasing_orders po ON po.id = p.purchasing_order_id
         ORDER BY p.id DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const payStmt = db.prepare(
      `SELECT pp.id, pp.amount, pp.payment_date as paymentDate, pp.method_note as methodNote, u.full_name as recordedByName
       FROM payable_payments pp JOIN users u ON u.id = pp.recorded_by
       WHERE pp.payable_id = ? ORDER BY pp.id DESC`
    );

    const items = rows
      .filter((r) => {
        if (status && String(r.status) !== status) return false;
        if (
          search &&
          !String(r.supplierName).toLowerCase().includes(search) &&
          !String(r.purchasingCode).toLowerCase().includes(search) &&
          !String(r.code).toLowerCase().includes(search)
        ) {
          return false;
        }
        return true;
      })
      .map((r) => ({
        id: Number(r.id),
        code: String(r.code),
        supplierId: Number(r.supplier_id),
        supplierName: String(r.supplierName),
        purchasingCode: String(r.purchasingCode),
        receivedKg: Number(r.receivedKg || 0),
        unitPrice: Number(r.unitPrice || 0),
        txDate: String(r.tx_date),
        totalAmount: Number(r.total_amount),
        paidAmount: Number(r.paid_amount),
        remainingAmount: Number(r.remaining_amount),
        status: String(r.status),
        payments: payStmt.all(Number(r.id)),
        isDemo: Number(r.is_demo) === 1,
      }));

    const summary = {
      totalPayable: items.reduce((s, i) => s + i.totalAmount, 0),
      totalPaid: items.reduce((s, i) => s + i.paidAmount, 0),
      totalRemaining: items.reduce((s, i) => s + i.remainingAmount, 0),
    };

    res.json({ summary, items });
  }
);

financeReportsUploadsRouter.post(
  '/finance/payables/:id/payments',
  requireAuth,
  requireRoles(RoleCode.OWNER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount);
    const paymentDate = String(req.body?.paymentDate || new Date().toISOString().slice(0, 10)).trim();
    const methodNote = String(req.body?.methodNote || '').trim();

    if (!Number.isFinite(amount) || amount <= 0 || !paymentDate) {
      res.status(400).json({ error: 'Vui lòng nhập số tiền thanh toán hợp lệ lớn hơn 0.' });
      return;
    }

    try {
      withTransaction((txDb) => {
        const pay = txDb.prepare(`SELECT * FROM payables WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!pay) throw new Error('NOT_FOUND');
        const rem = Number(pay.remaining_amount);
        if (amount > rem) throw new Error('OVERPAY');

        const now = new Date().toISOString();
        const newPaid = Math.round(Number(pay.paid_amount) + amount);
        const newRem = Math.max(0, Math.round(Number(pay.total_amount) - newPaid));
        const nextStatus = newRem === 0 ? 'PAID' : 'PARTIAL_PAID';

        txDb
          .prepare(
            `INSERT INTO payable_payments (payable_id, amount, payment_date, method_note, recorded_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(id, amount, paymentDate, methodNote, req.user!.id, now);

        txDb
          .prepare(
            `UPDATE payables SET paid_amount = ?, remaining_amount = ?, status = ?, updated_at = ? WHERE id = ?`
          )
          .run(newPaid, newRem, nextStatus, now, id);

        writeAuditLog(txDb, {
          entityType: 'PAYABLE',
          entityId: id,
          action: `Ghi nhận thanh toán NCC (${amount.toLocaleString('vi-VN')} đ)`,
          fromStatus: String(pay.status),
          toStatus: nextStatus,
          referenceCode: String(pay.code),
          actorId: req.user!.id,
          createdAt: now,
        });
      });

      res.status(201).json({ message: 'Đã ghi nhận khoản thanh toán nhà cung cấp.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'OVERPAY') {
        res.status(400).json({ error: 'Số tiền thanh toán vượt số dư còn phải trả.' });
      } else {
        res.status(404).json({ error: 'Không tìm thấy khoản phải trả.' });
      }
    }
  }
);

financeReportsUploadsRouter.get(
  '/finance/receivables',
  requireAuth,
  requireRoles(RoleCode.OWNER),
  (req, res) => {
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT r.*, c.name as customerName, o.code as outboundCode, o.dispatched_kg as dispatchedKg, o.unit_price as unitPrice
         FROM receivables r
         JOIN customers c ON c.id = r.customer_id
         JOIN outbound_orders o ON o.id = r.outbound_order_id
         ORDER BY r.id DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const recStmt = db.prepare(
      `SELECT rp.id, rp.amount, rp.payment_date as paymentDate, rp.method_note as methodNote, u.full_name as recordedByName
       FROM receivable_payments rp JOIN users u ON u.id = rp.recorded_by
       WHERE rp.receivable_id = ? ORDER BY rp.id DESC`
    );

    const items = rows
      .filter((r) => {
        if (status && String(r.status) !== status) return false;
        if (
          search &&
          !String(r.customerName).toLowerCase().includes(search) &&
          !String(r.outboundCode).toLowerCase().includes(search) &&
          !String(r.code).toLowerCase().includes(search)
        ) {
          return false;
        }
        return true;
      })
      .map((r) => ({
        id: Number(r.id),
        code: String(r.code),
        customerId: Number(r.customer_id),
        customerName: String(r.customerName),
        outboundCode: String(r.outboundCode),
        dispatchedKg: Number(r.dispatchedKg || 0),
        unitPrice: Number(r.unitPrice || 0),
        deliveryDate: String(r.delivery_date),
        totalAmount: Number(r.total_amount),
        paidAmount: Number(r.paid_amount),
        remainingAmount: Number(r.remaining_amount),
        status: String(r.status),
        payments: recStmt.all(Number(r.id)),
        isDemo: Number(r.is_demo) === 1,
      }));

    const summary = {
      totalReceivable: items.reduce((s, i) => s + i.totalAmount, 0),
      totalCollected: items.reduce((s, i) => s + i.paidAmount, 0),
      totalRemaining: items.reduce((s, i) => s + i.remainingAmount, 0),
    };

    res.json({ summary, items });
  }
);

financeReportsUploadsRouter.post(
  '/finance/receivables/:id/payments',
  requireAuth,
  requireRoles(RoleCode.OWNER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount);
    const paymentDate = String(req.body?.paymentDate || new Date().toISOString().slice(0, 10)).trim();
    const methodNote = String(req.body?.methodNote || '').trim();

    if (!Number.isFinite(amount) || amount <= 0 || !paymentDate) {
      res.status(400).json({ error: 'Vui lòng nhập số tiền thu hợp lệ lớn hơn 0.' });
      return;
    }

    try {
      withTransaction((txDb) => {
        const rec = txDb.prepare(`SELECT * FROM receivables WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!rec) throw new Error('NOT_FOUND');
        const rem = Number(rec.remaining_amount);
        if (amount > rem) throw new Error('OVERPAY');

        const now = new Date().toISOString();
        const newPaid = Math.round(Number(rec.paid_amount) + amount);
        const newRem = Math.max(0, Math.round(Number(rec.total_amount) - newPaid));
        const nextStatus = newRem === 0 ? 'PAID' : 'PARTIAL_PAID';

        txDb
          .prepare(
            `INSERT INTO receivable_payments (receivable_id, amount, payment_date, method_note, recorded_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(id, amount, paymentDate, methodNote, req.user!.id, now);

        txDb
          .prepare(
            `UPDATE receivables SET paid_amount = ?, remaining_amount = ?, status = ?, updated_at = ? WHERE id = ?`
          )
          .run(newPaid, newRem, nextStatus, now, id);

        writeAuditLog(txDb, {
          entityType: 'RECEIVABLE',
          entityId: id,
          action: `Ghi nhận khoản thu khách hàng (${amount.toLocaleString('vi-VN')} đ)`,
          fromStatus: String(rec.status),
          toStatus: nextStatus,
          referenceCode: String(rec.code),
          actorId: req.user!.id,
          createdAt: now,
        });
      });

      res.status(201).json({ message: 'Đã ghi nhận khoản thu từ khách hàng.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'OVERPAY') {
        res.status(400).json({ error: 'Số tiền thu vượt số dư còn phải thu.' });
      } else {
        res.status(404).json({ error: 'Không tìm thấy khoản phải thu.' });
      }
    }
  }
);

// ==================== DATA RECONCILIATION (ĐỐI CHIẾU SỐ LIỆU) ====================
financeReportsUploadsRouter.get(
  '/reconciliation',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER),
  (_req, res) => {
    const db = getDb();

    // 1. Purchasing Ticket vs Actual Warehouse Receipt
    const purchasingVsReceipt = db
      .prepare(
        `SELECT po.code, s.name as supplierName, po.request_date as date,
                po.weighed_kg as ticketKg, po.received_kg as receivedKg,
                po.discrepancy_kg as diffKg, po.discrepancy_note as note, po.status, po.is_demo as isDemo
         FROM purchasing_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.weighed_kg IS NOT NULL
         ORDER BY po.id DESC`
      )
      .all();

    // 2. Issued NVL vs Shift Report Used NVL per Plan
    const issuedVsShiftNvl = db
      .prepare(
        `SELECT p.code as planCode, p.plan_date as planDate, p.shift,
                COALESCE((SELECT SUM(l.quantity_kg) FROM raw_material_ledger l WHERE l.plan_id = p.id AND l.tx_type = 'OUT'), 0) as issuedKg,
                COALESCE((SELECT SUM(sr.nvl_used_kg) FROM shift_reports sr WHERE sr.plan_id = p.id AND sr.status = 'APPROVED'), 0) as reportedUsedKg,
                p.is_demo as isDemo
         FROM production_plans p
         ORDER BY p.id DESC`
      )
      .all();

    // 3. Shift Reported Output vs Warehouse Confirmed Finished Goods Receipt
    const reportedVsConfirmedOutput = db
      .prepare(
        `SELECT sr.code as reportCode, sr.batch_code as batchCode, sr.production_date as productionDate,
                sr.output_kg as reportedOutputKg, fb.initial_kg as confirmedReceiptKg,
                fb.warehouse_status as warehouseStatus, sr.is_demo as isDemo
         FROM shift_reports sr
         LEFT JOIN finished_batches fb ON fb.shift_report_id = sr.id
         WHERE sr.status = 'APPROVED'
         ORDER BY sr.id DESC`
      )
      .all();

    // 4. Approved Outbound vs Actual Dispatched
    const approvedVsDispatched = db
      .prepare(
        `SELECT o.code as orderCode, c.name as customerName, o.expected_date as expectedDate,
                o.requested_kg as approvedKg, o.dispatched_kg as actualDispatchedKg,
                (o.requested_kg - o.dispatched_kg) as remainingKg, o.status, o.is_demo as isDemo
         FROM outbound_orders o
         JOIN customers c ON c.id = o.customer_id
         WHERE o.status IN ('OWNER_APPROVED', 'READY_DISPATCH', 'PARTIALLY_DISPATCHED', 'DISPATCHED')
         ORDER BY o.id DESC`
      )
      .all();

    res.json({
      purchasingVsReceipt,
      issuedVsShiftNvl,
      reportedVsConfirmedOutput,
      approvedVsDispatched,
    });
  }
);

// ==================== REPORTS (10 REPORT GROUPS) ====================
financeReportsUploadsRouter.get(
  '/reports',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const category = String(req.query.category || 'production').trim();
    const fromDate = String(req.query.fromDate || '').trim();
    const toDate = String(req.query.toDate || '').trim();
    const shift = String(req.query.shift || '').trim();
    const status = String(req.query.status || '').trim();
    const db = getDb();
    const isOwner = req.user!.role === RoleCode.OWNER;

    if ((category === 'receivables' || category === 'payables') && !isOwner) {
      res.status(403).json({ error: 'Báo cáo công nợ chỉ dành cho Chủ doanh nghiệp.' });
      return;
    }

    const inDateRange = (d: string) => {
      const day = String(d || '').slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    };

    if (category === 'production') {
      const rows = (
        db
          .prepare(
            `SELECT sr.code, sr.batch_code as batchCode, sr.production_date as date, sr.shift,
                    p.code as planCode, u.full_name as staffName,
                    sr.nvl_used_kg as nvlUsedKg, sr.output_kg as outputKg, sr.status, sr.is_demo as isDemo
             FROM shift_reports sr
             JOIN production_plans p ON p.id = sr.plan_id
             JOIN users u ON u.id = sr.staff_id
             ORDER BY sr.production_date DESC, sr.id DESC`
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => {
        if (!inDateRange(String(r.date))) return false;
        if (shift && String(r.shift) !== shift) return false;
        if (status && String(r.status) !== status) return false;
        return true;
      });
      res.json({ category, rows });
      return;
    }

    if (category === 'raw_inventory') {
      const rows = (
        db
          .prepare(
            `SELECT l.tx_code as code, substr(l.created_at, 1, 10) as date, l.tx_type as txType,
                    l.quantity_kg as quantityKg, l.balance_after_kg as balanceAfterKg,
                    l.reference_code as referenceCode, l.shift, u.full_name as actorName, l.is_demo as isDemo
             FROM raw_material_ledger l JOIN users u ON u.id = l.actor_id
             ORDER BY l.id DESC`
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => {
        if (!inDateRange(String(r.date))) return false;
        if (shift && String(r.shift || '') !== shift) return false;
        if (status && String(r.txType) !== status) return false;
        return true;
      });
      res.json({ category, rows });
      return;
    }

    if (category === 'finished_inventory') {
      const rows = (
        db
          .prepare(
            `SELECT batch_code as batchCode, production_date as date, shift, grade,
                    initial_kg as initialKg, dispatched_kg as dispatchedKg, available_kg as availableKg,
                    qc_status as qcStatus, warehouse_status as status, is_demo as isDemo
             FROM finished_batches
             WHERE warehouse_status IN ('IN_STOCK', 'DEPLETED')
             ORDER BY production_date DESC, id DESC`
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => {
        if (!inDateRange(String(r.date))) return false;
        if (shift && String(r.shift) !== shift) return false;
        if (status && String(r.status) !== status) return false;
        return true;
      });
      res.json({ category, rows });
      return;
    }

    if (category === 'purchasing') {
      const rows = (
        db
          .prepare(
            `SELECT po.code, po.request_date as date, s.name as supplierName,
                    u.full_name as purchasingStaff, po.weighed_kg as weighedKg,
                    po.received_kg as receivedKg, po.unit_price as unitPrice,
                    po.status, po.is_demo as isDemo
             FROM purchasing_orders po
             JOIN suppliers s ON s.id = po.supplier_id
             JOIN users u ON u.id = po.assigned_to
             ORDER BY po.id DESC`
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => {
        if (!inDateRange(String(r.date))) return false;
        if (status && String(r.status) !== status) return false;
        return true;
      });
      res.json({ category, rows });
      return;
    }

    if (category === 'qc') {
      const rows = (
        db
          .prepare(
            `SELECT q.code, substr(q.inspected_at, 1, 10) as date,
                    fb.batch_code as batchCode, fb.shift, q.grade,
                    q.moisture_note as moistureNote, q.inspection_result as status,
                    u.full_name as inspectorName, q.is_demo as isDemo
             FROM qc_inspections q
             JOIN finished_batches fb ON fb.id = q.batch_id
             JOIN users u ON u.id = q.inspector_id
             WHERE q.inspection_type = 'SHIFT_QC'
             ORDER BY q.id DESC`
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => {
        if (!inDateRange(String(r.date))) return false;
        if (shift && String(r.shift) !== shift) return false;
        if (status && String(r.status) !== status) return false;
        return true;
      });
      res.json({ category, rows });
      return;
    }

    if (category === 'outbound') {
      const rows = (
        db
          .prepare(
            `SELECT o.code, o.expected_date as date, c.name as customerName,
                    o.accepted_grade as grade, o.requested_kg as requestedKg,
                    o.dispatched_kg as dispatchedKg,
                    ${isOwner ? 'o.unit_price as unitPrice, o.total_value as totalValue,' : 'NULL as unitPrice, NULL as totalValue,'}
                    o.status, o.is_demo as isDemo
             FROM outbound_orders o
             JOIN customers c ON c.id = o.customer_id
             ORDER BY o.id DESC`
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => {
        if (!inDateRange(String(r.date))) return false;
        if (status && String(r.status) !== status) return false;
        return true;
      });
      res.json({ category, rows });
      return;
    }

    if (category === 'maintenance') {
      const rows = (
        db
          .prepare(
            `SELECT mr.code, substr(mr.created_at, 1, 10) as date, m.name as machineName,
                    mr.issue_type as issueType, mr.severity,
                    u_req.full_name as requestedByName, u_tech.full_name as assignedToName,
                    mr.status, mr.is_demo as isDemo
             FROM maintenance_requests mr
             JOIN machines m ON m.id = mr.machine_id
             JOIN users u_req ON u_req.id = mr.requested_by
             LEFT JOIN users u_tech ON u_tech.id = mr.assigned_to
             ORDER BY mr.id DESC`
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => {
        if (!inDateRange(String(r.date))) return false;
        if (status && String(r.status) !== status) return false;
        return true;
      });
      res.json({ category, rows });
      return;
    }

    if (category === 'receivables') {
      const rows = (
        db
          .prepare(
            `SELECT r.code, r.delivery_date as date, c.name as customerName, o.code as outboundCode,
                    r.total_amount as totalAmount, r.paid_amount as paidAmount,
                    r.remaining_amount as remainingAmount, r.status, r.is_demo as isDemo
             FROM receivables r
             JOIN customers c ON c.id = r.customer_id
             JOIN outbound_orders o ON o.id = r.outbound_order_id
             ORDER BY r.id DESC`
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => {
        if (!inDateRange(String(r.date))) return false;
        if (status && String(r.status) !== status) return false;
        return true;
      });
      res.json({ category, rows });
      return;
    }

    if (category === 'payables') {
      const rows = (
        db
          .prepare(
            `SELECT p.code, p.tx_date as date, s.name as supplierName, po.code as purchasingCode,
                    p.total_amount as totalAmount, p.paid_amount as paidAmount,
                    p.remaining_amount as remainingAmount, p.status, p.is_demo as isDemo
             FROM payables p
             JOIN suppliers s ON s.id = p.supplier_id
             JOIN purchasing_orders po ON po.id = p.purchasing_order_id
             ORDER BY p.id DESC`
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => {
        if (!inDateRange(String(r.date))) return false;
        if (status && String(r.status) !== status) return false;
        return true;
      });
      res.json({ category, rows });
      return;
    }

    // Operational Summary ('operations') — strictly factual recorded figures, NO fabricated profit/loss formulas!
    const totalNvlReceived = Number(
      (
        db
          .prepare(`SELECT COALESCE(SUM(received_kg), 0) as v FROM purchasing_orders WHERE status = 'RECEIVED'`)
          .get() as { v: number }
      ).v
    );
    const totalNvlIssued = Number(
      (
        db
          .prepare(`SELECT COALESCE(SUM(quantity_kg), 0) as v FROM raw_material_ledger WHERE tx_type = 'OUT'`)
          .get() as { v: number }
      ).v
    );
    const totalFgProduced = Number(
      (
        db
          .prepare(`SELECT COALESCE(SUM(initial_kg), 0) as v FROM finished_batches WHERE warehouse_status IN ('IN_STOCK', 'DEPLETED')`)
          .get() as { v: number }
      ).v
    );
    const totalFgDispatched = Number(
      (
        db.prepare(`SELECT COALESCE(SUM(dispatched_kg), 0) as v FROM outbound_dispatches`).get() as {
          v: number;
        }
      ).v
    );
    const openIncidents = Number(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM maintenance_requests WHERE status != 'COMPLETED'`)
          .get() as { c: number }
      ).c
    );

    res.json({
      category: 'operations',
      rows: [
        { metric: 'Tổng khối lượng NVL thực nhận nhập kho', unit: 'kg', value: totalNvlReceived },
        { metric: 'Tổng khối lượng NVL đã cấp cho sản xuất', unit: 'kg', value: totalNvlIssued },
        { metric: 'Tổng khối lượng thành phẩm đã nhập kho', unit: 'kg', value: totalFgProduced },
        { metric: 'Tổng khối lượng thành phẩm đã bàn giao thực tế', unit: 'kg', value: totalFgDispatched },
        { metric: 'Sự cố máy móc chưa hoàn tất', unit: 'yêu cầu', value: openIncidents },
      ],
      pendingFormulaConfirmations: [
        'Định mức tiêu hao NVL chuẩn theo độ ẩm mùa vụ (chờ doanh nghiệp cấu hình)',
        'Công thức phân bổ điện năng, nhân công và chi phí sấy vào giá thành (chờ doanh nghiệp cấu hình)',
      ],
    });
  }
);
