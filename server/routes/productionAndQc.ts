import { Router } from 'express';
import { getDb, withTransaction } from '../db.ts';
import { requireAuth, requireRoles, type AuthedRequest } from '../security.ts';
import {
  generateBatchCode,
  generateCode,
  getEntityAttachments,
  getEntityHistory,
  notifyRoles,
  notifyUser,
  writeAuditLog,
} from '../auditAndNotify.ts';
import { RoleCode } from '../../shared/types.ts';

export const productionAndQcRouter = Router();

// ==================== PRODUCTION PLANS & STAFF ASSIGNMENTS ====================
productionAndQcRouter.get(
  '/production/plans',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.WAREHOUSE_KEEPER, RoleCode.STAFF),
  (req: AuthedRequest, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const db = getDb();

    let whereSql = '';
    const params: Array<number | string> = [];
    if (req.user!.role === RoleCode.STAFF) {
      whereSql = `WHERE EXISTS (SELECT 1 FROM plan_assignments pa WHERE pa.plan_id = p.id AND pa.staff_id = ?)`;
      params.push(req.user!.id);
    }

    const plans = db
      .prepare(
        `SELECT p.*, m.code as machineCode, m.name as machineName,
                u_cr.full_name as createdByName,
                COALESCE((SELECT SUM(l.quantity_kg) FROM raw_material_ledger l WHERE l.plan_id = p.id AND l.tx_type = 'OUT'), 0) as issuedNvlKg,
                COALESCE((SELECT SUM(sr.output_kg) FROM shift_reports sr WHERE sr.plan_id = p.id AND sr.status = 'APPROVED'), 0) as approvedOutputKg
         FROM production_plans p
         LEFT JOIN machines m ON m.id = p.machine_id
         JOIN users u_cr ON u_cr.id = p.created_by
         ${whereSql}
         ORDER BY p.plan_date DESC, p.id DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const assignStmt = db.prepare(
      `SELECT pa.staff_id as staffId, pa.task_role as taskRole, u.full_name as staffName
       FROM plan_assignments pa
       JOIN users u ON u.id = pa.staff_id
       WHERE pa.plan_id = ?`
    );

    const items = plans
      .map((p) => {
        const assignments = assignStmt.all(Number(p.id)) as Array<{
          staffId: number;
          taskRole: string;
          staffName: string;
        }>;
        return {
          id: Number(p.id),
          code: String(p.code),
          planDate: String(p.plan_date),
          shift: String(p.shift),
          targetKg: Number(p.target_kg),
          machineId: p.machine_id !== null ? Number(p.machine_id) : null,
          machineCode: p.machineCode ? String(p.machineCode) : '',
          machineName: p.machineName ? String(p.machineName) : '',
          note: String(p.note || ''),
          status: String(p.status),
          createdByName: String(p.createdByName),
          issuedNvlKg: Number(p.issuedNvlKg || 0),
          approvedOutputKg: Number(p.approvedOutputKg || 0),
          assignments,
          isDemo: Number(p.is_demo) === 1,
          createdAt: String(p.created_at),
        };
      })
      .filter((item) => {
        if (status && item.status !== status) return false;
        if (
          search &&
          !item.code.toLowerCase().includes(search) &&
          !item.machineName.toLowerCase().includes(search) &&
          !item.assignments.some((a) => a.staffName.toLowerCase().includes(search))
        ) {
          return false;
        }
        return true;
      });

    res.json({ items });
  }
);

productionAndQcRouter.post(
  '/production/plans',
  requireAuth,
  requireRoles(RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const planDate = String(req.body?.planDate || '').trim();
    const shift = String(req.body?.shift || '').trim();
    const targetKg = Number(req.body?.targetKg);
    const machineId = req.body?.machineId ? Number(req.body.machineId) : null;
    const note = String(req.body?.note || '').trim();
    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];

    if (!planDate || !['Ca 1', 'Ca 2', 'Ca 3'].includes(shift) || !Number.isFinite(targetKg) || targetKg <= 0) {
      res.status(400).json({
        error: 'Vui lòng nhập ngày sản xuất, ca làm việc và mục tiêu sản lượng lớn hơn 0.',
      });
      return;
    }
    if (assignments.length === 0) {
      res.status(400).json({ error: 'Vui lòng phân công ít nhất một công nhân cho kế hoạch.' });
      return;
    }

    const created = withTransaction((db) => {
      const code = generateCode(db, 'production_plans', 'KH', planDate);
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO production_plans (code, plan_date, shift, target_kg, machine_id, note, status, created_by, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'PLANNED', ?, 0, ?, ?)`
        )
        .run(code, planDate, shift, targetKg, machineId, note, req.user!.id, now, now);
      const planId = Number(info.lastInsertRowid);

      const insAssign = db.prepare(
        `INSERT OR IGNORE INTO plan_assignments (plan_id, staff_id, task_role) VALUES (?, ?, ?)`
      );
      for (const a of assignments) {
        const staffId = Number(a.staffId);
        const taskRole = String(a.taskRole || 'Vận hành sản xuất').trim();
        if (staffId > 0) {
          insAssign.run(planId, staffId, taskRole);
          notifyUser(db, {
            userId: staffId,
            dedupKey: `plan-assign-${planId}-u${staffId}`,
            title: 'Phân công ca sản xuất mới',
            message: `Bạn được phân công kế hoạch ${code} (${shift} ngày ${planDate}).`,
            targetPath: '/cong-viec-phan-cong',
            referenceCode: code,
          });
        }
      }

      writeAuditLog(db, {
        entityType: 'PRODUCTION_PLAN',
        entityId: planId,
        action: 'Lập kế hoạch và phân công nhân sự',
        toStatus: 'PLANNED',
        referenceCode: code,
        actorId: req.user!.id,
        createdAt: now,
      });

      return { id: planId, code };
    });

    res.status(201).json({ message: `Đã lập kế hoạch sản xuất ${created.code}.`, ...created });
  }
);

productionAndQcRouter.put(
  '/production/plans/:id',
  requireAuth,
  requireRoles(RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const planDate = String(req.body?.planDate || '').trim();
    const shift = String(req.body?.shift || '').trim();
    const targetKg = Number(req.body?.targetKg);
    const machineId = req.body?.machineId ? Number(req.body.machineId) : null;
    const note = String(req.body?.note || '').trim();
    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];

    if (!planDate || !['Ca 1', 'Ca 2', 'Ca 3'].includes(shift) || !Number.isFinite(targetKg) || targetKg <= 0) {
      res.status(400).json({ error: 'Thông tin cập nhật kế hoạch không hợp lệ.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM production_plans WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy kế hoạch sản xuất.' });
      return;
    }
    if (['COMPLETED', 'CANCELLED'].includes(String(existing.status))) {
      res.status(400).json({ error: 'Kế hoạch đã hoàn tất hoặc đã khóa, không thể chỉnh sửa.' });
      return;
    }

    withTransaction((txDb) => {
      const now = new Date().toISOString();
      txDb
        .prepare(
          `UPDATE production_plans
           SET plan_date = ?, shift = ?, target_kg = ?, machine_id = ?, note = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(planDate, shift, targetKg, machineId, note, now, id);

      if (assignments.length > 0) {
        txDb.prepare(`DELETE FROM plan_assignments WHERE plan_id = ?`).run(id);
        const insAssign = txDb.prepare(
          `INSERT OR IGNORE INTO plan_assignments (plan_id, staff_id, task_role) VALUES (?, ?, ?)`
        );
        for (const a of assignments) {
          const staffId = Number(a.staffId);
          const taskRole = String(a.taskRole || 'Vận hành sản xuất').trim();
          if (staffId > 0) {
            insAssign.run(id, staffId, taskRole);
          }
        }
      }

      writeAuditLog(txDb, {
        entityType: 'PRODUCTION_PLAN',
        entityId: id,
        action: 'Cập nhật kế hoạch & phân công',
        fromStatus: String(existing.status),
        toStatus: String(existing.status),
        referenceCode: String(existing.code),
        actorId: req.user!.id,
        createdAt: now,
      });
    });

    res.json({ message: 'Đã cập nhật kế hoạch sản xuất.' });
  }
);

// Manager confirms plan completed (Strictly Manager only, never Staff!)
productionAndQcRouter.post(
  '/production/plans/:id/complete',
  requireAuth,
  requireRoles(RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM production_plans WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy kế hoạch sản xuất.' });
      return;
    }
    if (String(existing.status) === 'COMPLETED') {
      res.status(400).json({ error: 'Kế hoạch sản xuất đã ở trạng thái hoàn tất.' });
      return;
    }

    const pendingReports = db
      .prepare(`SELECT COUNT(*) as cnt FROM shift_reports WHERE plan_id = ? AND status = 'SUBMITTED'`)
      .get(id) as { cnt: number };
    if (Number(pendingReports.cnt) > 0) {
      res.status(400).json({
        error: 'Còn báo cáo ca chờ xử lý thuộc kế hoạch này. Vui lòng xử lý báo cáo ca trước.',
      });
      return;
    }

    withTransaction((txDb) => {
      const now = new Date().toISOString();
      txDb
        .prepare(
          `UPDATE production_plans SET status = 'COMPLETED', completed_by = ?, completed_at = ?, updated_at = ? WHERE id = ?`
        )
        .run(req.user!.id, now, now, id);
      writeAuditLog(txDb, {
        entityType: 'PRODUCTION_PLAN',
        entityId: id,
        action: 'Xác nhận hoàn tất kế hoạch sản xuất',
        fromStatus: String(existing.status),
        toStatus: 'COMPLETED',
        referenceCode: String(existing.code),
        actorId: req.user!.id,
        createdAt: now,
      });
    });

    res.json({ message: 'Đã xác nhận hoàn tất kế hoạch sản xuất.' });
  }
);

// ==================== SHIFT REPORTS ====================
productionAndQcRouter.get(
  '/production/shift-reports',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.STAFF),
  (req: AuthedRequest, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const db = getDb();

    let whereSql = '';
    const params: Array<number | string> = [];
    if (req.user!.role === RoleCode.STAFF) {
      whereSql = `WHERE sr.staff_id = ?`;
      params.push(req.user!.id);
    }

    const rows = db
      .prepare(
        `SELECT sr.*,
                p.code as planCode, p.target_kg as planTargetKg,
                u_st.full_name as staffName,
                u_rev.full_name as reviewedByName,
                fb.id as batchId, fb.grade as batchGrade, fb.qc_status as batchQcStatus, fb.warehouse_status as batchWarehouseStatus
         FROM shift_reports sr
         JOIN production_plans p ON p.id = sr.plan_id
         JOIN users u_st ON u_st.id = sr.staff_id
         LEFT JOIN users u_rev ON u_rev.id = sr.reviewed_by
         LEFT JOIN finished_batches fb ON fb.shift_report_id = sr.id
         ${whereSql}
         ORDER BY sr.id DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const items = rows
      .filter((r) => {
        if (status && String(r.status) !== status) return false;
        if (
          search &&
          !String(r.code).toLowerCase().includes(search) &&
          !String(r.batch_code).toLowerCase().includes(search) &&
          !String(r.staffName).toLowerCase().includes(search) &&
          !String(r.planCode).toLowerCase().includes(search)
        ) {
          return false;
        }
        return true;
      })
      .map((r) => ({
        id: Number(r.id),
        code: String(r.code),
        batchCode: String(r.batch_code),
        planId: Number(r.plan_id),
        planCode: String(r.planCode),
        planTargetKg: Number(r.planTargetKg),
        productionDate: String(r.production_date),
        shift: String(r.shift),
        staffId: Number(r.staff_id),
        staffName: String(r.staffName),
        nvlUsedKg: Number(r.nvl_used_kg),
        outputKg: Number(r.output_kg),
        note: String(r.note || ''),
        status: String(r.status),
        submittedAt: String(r.submitted_at),
        reviewedByName: r.reviewedByName ? String(r.reviewedByName) : null,
        reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
        rejectReason: r.reject_reason ? String(r.reject_reason) : null,
        batchId: r.batchId !== null ? Number(r.batchId) : null,
        batchGrade: r.batchGrade ? String(r.batchGrade) : null,
        batchQcStatus: r.batchQcStatus ? String(r.batchQcStatus) : null,
        batchWarehouseStatus: r.batchWarehouseStatus ? String(r.batchWarehouseStatus) : null,
        isDemo: Number(r.is_demo) === 1,
      }));

    res.json({ items });
  }
);

productionAndQcRouter.get(
  '/production/shift-reports/:id',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.STAFF),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const r = db
      .prepare(
        `SELECT sr.*, p.code as planCode, p.target_kg as planTargetKg,
                u_st.full_name as staffName, u_rev.full_name as reviewedByName,
                fb.id as batchId, fb.grade as batchGrade, fb.qc_status as batchQcStatus, fb.warehouse_status as batchWarehouseStatus
         FROM shift_reports sr
         JOIN production_plans p ON p.id = sr.plan_id
         JOIN users u_st ON u_st.id = sr.staff_id
         LEFT JOIN users u_rev ON u_rev.id = sr.reviewed_by
         LEFT JOIN finished_batches fb ON fb.shift_report_id = sr.id
         WHERE sr.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!r) {
      res.status(404).json({ error: 'Không tìm thấy báo cáo ca.' });
      return;
    }
    if (req.user!.role === RoleCode.STAFF && Number(r.staff_id) !== req.user!.id) {
      res.status(403).json({ error: 'Bạn chỉ được xem báo cáo ca của mình.' });
      return;
    }

    res.json({
      report: {
        id: Number(r.id),
        code: String(r.code),
        batchCode: String(r.batch_code),
        planId: Number(r.plan_id),
        planCode: String(r.planCode),
        planTargetKg: Number(r.planTargetKg),
        productionDate: String(r.production_date),
        shift: String(r.shift),
        staffId: Number(r.staff_id),
        staffName: String(r.staffName),
        nvlUsedKg: Number(r.nvl_used_kg),
        outputKg: Number(r.output_kg),
        note: String(r.note || ''),
        status: String(r.status),
        submittedAt: String(r.submitted_at),
        reviewedByName: r.reviewedByName ? String(r.reviewedByName) : null,
        reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
        rejectReason: r.reject_reason ? String(r.reject_reason) : null,
        batchGrade: r.batchGrade ? String(r.batchGrade) : null,
        batchQcStatus: r.batchQcStatus ? String(r.batchQcStatus) : null,
        batchWarehouseStatus: r.batchWarehouseStatus ? String(r.batchWarehouseStatus) : null,
        isDemo: Number(r.is_demo) === 1,
      },
      attachments: getEntityAttachments(db, 'SHIFT_REPORT', id),
      history: getEntityHistory(db, 'SHIFT_REPORT', id),
    });
  }
);

// Staff submits Shift Report -> auto-generates unique batch code, NO inventory increase!
productionAndQcRouter.post(
  '/production/shift-reports',
  requireAuth,
  requireRoles(RoleCode.STAFF),
  (req: AuthedRequest, res) => {
    const planId = Number(req.body?.planId);
    const nvlUsedKg = Number(req.body?.nvlUsedKg);
    const outputKg = Number(req.body?.outputKg);
    const note = String(req.body?.note || '').trim();

    if (!planId || !Number.isFinite(nvlUsedKg) || nvlUsedKg <= 0 || !Number.isFinite(outputKg) || outputKg <= 0) {
      res.status(400).json({
        error: 'Vui lòng chọn kế hoạch và nhập khối lượng NVL thực tế sử dụng cùng sản lượng thành phẩm lớn hơn 0.',
      });
      return;
    }

    try {
      const created = withTransaction((db) => {
        const plan = db.prepare(`SELECT * FROM production_plans WHERE id = ?`).get(planId) as
          | Record<string, unknown>
          | undefined;
        if (!plan || ['COMPLETED', 'CANCELLED'].includes(String(plan.status))) {
          throw new Error('INVALID_PLAN');
        }

        const assigned = db
          .prepare(`SELECT 1 FROM plan_assignments WHERE plan_id = ? AND staff_id = ?`)
          .get(planId, req.user!.id);
        if (!assigned) {
          throw new Error('NOT_ASSIGNED');
        }

        const productionDate = String(plan.plan_date);
        const shift = String(plan.shift);
        const code = generateCode(db, 'shift_reports', 'BC', productionDate);
        const batchCode = generateBatchCode(db, productionDate, shift);
        const now = new Date().toISOString();

        const info = db
          .prepare(
            `INSERT INTO shift_reports (
              code, batch_code, plan_id, production_date, shift, staff_id,
              nvl_used_kg, output_kg, note, status, submitted_at, is_demo, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, 0, ?, ?)`
          )
          .run(
            code,
            batchCode,
            planId,
            productionDate,
            shift,
            req.user!.id,
            nvlUsedKg,
            outputKg,
            note,
            now,
            now,
            now
          );
        const reportId = Number(info.lastInsertRowid);

        writeAuditLog(db, {
          entityType: 'SHIFT_REPORT',
          entityId: reportId,
          action: `Gửi báo cáo ca (Mã lô ${batchCode})`,
          toStatus: 'SUBMITTED',
          referenceCode: code,
          actorId: req.user!.id,
          createdAt: now,
        });

        notifyRoles(db, [RoleCode.MANAGER], {
          dedupPrefix: `sr-submit-${reportId}`,
          title: 'Báo cáo ca mới chờ xử lý',
          message: `${req.user!.fullName} đã gửi báo cáo ca ${code} (lô ${batchCode}, ${outputKg.toLocaleString('vi-VN')} kg).`,
          targetPath: '/bao-cao-ca',
          referenceCode: code,
        });

        return { id: reportId, code, batchCode };
      });

      res.status(201).json({
        message: `Đã gửi báo cáo ca ${created.code} (Mã lô ${created.batchCode}).`,
        ...created,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NOT_ASSIGNED') {
        res.status(403).json({ error: 'Bạn chỉ được gửi báo cáo cho kế hoạch được phân công.' });
      } else if (msg === 'INVALID_PLAN') {
        res.status(400).json({ error: 'Kế hoạch sản xuất đã đóng hoặc không hợp lệ.' });
      } else {
        res.status(500).json({ error: 'Không thể gửi báo cáo ca.' });
      }
    }
  }
);

// Staff updates rejected Shift Report without generating duplicate batch code
productionAndQcRouter.put(
  '/production/shift-reports/:id',
  requireAuth,
  requireRoles(RoleCode.STAFF),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const nvlUsedKg = Number(req.body?.nvlUsedKg);
    const outputKg = Number(req.body?.outputKg);
    const note = String(req.body?.note || '').trim();

    if (!Number.isFinite(nvlUsedKg) || nvlUsedKg <= 0 || !Number.isFinite(outputKg) || outputKg <= 0) {
      res.status(400).json({ error: 'Khối lượng NVL và sản lượng phải lớn hơn 0.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM shift_reports WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy báo cáo ca.' });
      return;
    }
    if (Number(existing.staff_id) !== req.user!.id) {
      res.status(403).json({ error: 'Bạn chỉ được chỉnh sửa báo cáo của chính mình.' });
      return;
    }
    if (String(existing.status) !== 'REJECTED') {
      res.status(400).json({ error: 'Chỉ được chỉnh sửa báo cáo ca khi bị trả lại yêu cầu chỉnh sửa.' });
      return;
    }

    withTransaction((txDb) => {
      const now = new Date().toISOString();
      txDb
        .prepare(
          `UPDATE shift_reports
           SET nvl_used_kg = ?, output_kg = ?, note = ?, status = 'SUBMITTED', submitted_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nvlUsedKg, outputKg, note, now, now, id);

      writeAuditLog(txDb, {
        entityType: 'SHIFT_REPORT',
        entityId: id,
        action: 'Chỉnh sửa và gửi lại báo cáo ca',
        fromStatus: 'REJECTED',
        toStatus: 'SUBMITTED',
        referenceCode: String(existing.code),
        actorId: req.user!.id,
        createdAt: now,
      });

      notifyRoles(txDb, [RoleCode.MANAGER], {
        dedupPrefix: `sr-resubmit-${id}-${now}`,
        title: 'Báo cáo ca đã chỉnh sửa gửi lại',
        message: `Báo cáo ca ${existing.code} đã được cập nhật và gửi lại chờ duyệt.`,
        targetPath: '/bao-cao-ca',
        referenceCode: String(existing.code),
      });
    });

    res.json({ message: 'Đã gửi lại báo cáo ca chờ Quản lý xưởng duyệt.' });
  }
);

// Manager approves or rejects Shift Report (creates batch in PENDING_QC, available_kg = 0)
productionAndQcRouter.post(
  '/production/shift-reports/:id/decision',
  requireAuth,
  requireRoles(RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const decision = String(req.body?.decision || '').trim(); // 'APPROVE' | 'REJECT'
    const reason = String(req.body?.reason || '').trim();

    if (!['APPROVE', 'REJECT'].includes(decision)) {
      res.status(400).json({ error: 'Thao tác không hợp lệ.' });
      return;
    }
    if (decision === 'REJECT' && !reason) {
      res.status(400).json({ error: 'Vui lòng nhập lý do từ chối báo cáo ca.' });
      return;
    }

    try {
      withTransaction((txDb) => {
        const sr = txDb.prepare(`SELECT * FROM shift_reports WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!sr) throw new Error('NOT_FOUND');
        if (Number(sr.staff_id) === req.user!.id) throw new Error('SELF_APPROVAL');
        if (String(sr.status) !== 'SUBMITTED') throw new Error('INVALID_STATE');
        if (Number(sr.output_kg) <= 0 || Number(sr.nvl_used_kg) <= 0) throw new Error('INVALID_DATA');

        const now = new Date().toISOString();
        const nextStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

        txDb
          .prepare(
            `UPDATE shift_reports
             SET status = ?, reviewed_by = ?, reviewed_at = ?, reject_reason = ?, updated_at = ?
             WHERE id = ? AND status = 'SUBMITTED'`
          )
          .run(nextStatus, req.user!.id, now, decision === 'REJECT' ? reason : null, now, id);

        if (decision === 'APPROVE') {
          // Idempotently register finished batch waiting for Shift QC (available_kg = 0)
          txDb
            .prepare(
              `INSERT OR IGNORE INTO finished_batches (
                batch_code, shift_report_id, plan_id, production_date, shift, producer_id,
                produced_kg, initial_kg, dispatched_kg, available_kg, grade, qc_status, warehouse_status,
                packaging_info, is_demo, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, 'PENDING_QC', 'PENDING_QC', 'Bao Jumbo', 0, ?, ?)`
            )
            .run(
              String(sr.batch_code),
              id,
              Number(sr.plan_id),
              String(sr.production_date),
              String(sr.shift),
              Number(sr.staff_id),
              Number(sr.output_kg),
              now,
              now
            );

          notifyRoles(txDb, [RoleCode.QC_STAFF], {
            dedupPrefix: `batch-qc-ready-${id}`,
            title: 'Lô thành phẩm chờ QC theo ca',
            message: `Lô ${sr.batch_code} (${Number(sr.output_kg).toLocaleString('vi-VN')} kg) đã được duyệt sản xuất, chờ kiểm tra QC.`,
            targetPath: '/kiem-tra-chat-luong',
            referenceCode: String(sr.batch_code),
          });
        } else {
          notifyUser(txDb, {
            userId: Number(sr.staff_id),
            dedupKey: `sr-reject-${id}-${now}`,
            title: 'Báo cáo ca cần chỉnh sửa',
            message: `Báo cáo ca ${sr.code} bị trả lại: ${reason}`,
            targetPath: '/bao-cao-ca',
            referenceCode: String(sr.code),
          });
        }

        writeAuditLog(txDb, {
          entityType: 'SHIFT_REPORT',
          entityId: id,
          action: decision === 'APPROVE' ? 'Duyệt báo cáo ca' : 'Trả lại báo cáo ca',
          fromStatus: 'SUBMITTED',
          toStatus: nextStatus,
          reason: decision === 'REJECT' ? reason : null,
          referenceCode: String(sr.code),
          actorId: req.user!.id,
          createdAt: now,
        });
      });

      res.json({
        message:
          decision === 'APPROVE'
            ? 'Đã duyệt báo cáo ca và chuyển lô sang bước QC theo ca.'
            : 'Đã trả lại báo cáo ca kèm lý do chỉnh sửa.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NOT_FOUND') {
        res.status(404).json({ error: 'Không tìm thấy báo cáo ca.' });
      } else if (msg === 'SELF_APPROVAL') {
        res.status(403).json({ error: 'Không được tự duyệt báo cáo ca của chính mình.' });
      } else if (msg === 'INVALID_STATE') {
        res.status(400).json({ error: 'Báo cáo ca không ở trạng thái chờ duyệt.' });
      } else {
        res.status(400).json({ error: 'Dữ liệu báo cáo ca không hợp lệ để duyệt.' });
      }
    }
  }
);

// ==================== QUALITY CONTROL (SHIFT QC) & FINISHED GOODS WAREHOUSE ====================
productionAndQcRouter.get(
  '/qc/shift',
  requireAuth,
  requireRoles(RoleCode.QC_STAFF, RoleCode.MANAGER, RoleCode.OWNER, RoleCode.WAREHOUSE_KEEPER),
  (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const qcStatus = String(req.query.qcStatus || '').trim();
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT fb.*,
                u_prod.full_name as producerName,
                p.code as planCode,
                sr.code as shiftReportCode,
                u_rec.full_name as receivedByName
         FROM finished_batches fb
         JOIN users u_prod ON u_prod.id = fb.producer_id
         JOIN production_plans p ON p.id = fb.plan_id
         JOIN shift_reports sr ON sr.id = fb.shift_report_id
         LEFT JOIN users u_rec ON u_rec.id = fb.received_by
         ORDER BY fb.id DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const inspStmt = db.prepare(
      `SELECT q.*, u.full_name as inspectorName
       FROM qc_inspections q
       JOIN users u ON u.id = q.inspector_id
       WHERE q.batch_id = ? AND q.inspection_type = 'SHIFT_QC'
       ORDER BY q.id DESC`
    );

    const items = rows
      .map((r) => {
        const inspections = (inspStmt.all(Number(r.id)) as Array<Record<string, unknown>>).map(
          (q) => ({
            id: Number(q.id),
            code: String(q.code),
            grade: String(q.grade),
            inspectionResult: String(q.inspection_result),
            moistureNote: String(q.moisture_note || ''),
            durabilityNote: String(q.durability_note || ''),
            appearanceNote: String(q.appearance_note || ''),
            foreignMatterNote: String(q.foreign_matter_note || ''),
            note: String(q.note || ''),
            inspectorName: String(q.inspectorName),
            inspectedAt: String(q.inspected_at),
            attachments: getEntityAttachments(db, 'QC', Number(q.id)),
          })
        );
        return {
          id: Number(r.id),
          batchCode: String(r.batch_code),
          planCode: String(r.planCode),
          shiftReportCode: String(r.shiftReportCode),
          productionDate: String(r.production_date),
          shift: String(r.shift),
          producerName: String(r.producerName),
          producedKg: Number(r.produced_kg),
          initialKg: Number(r.initial_kg),
          dispatchedKg: Number(r.dispatched_kg),
          availableKg: Number(r.available_kg),
          grade: r.grade ? String(r.grade) : null,
          qcStatus: String(r.qc_status),
          warehouseStatus: String(r.warehouse_status),
          packagingInfo: String(r.packaging_info || ''),
          receivedByName: r.receivedByName ? String(r.receivedByName) : null,
          receivedAt: r.received_at ? String(r.received_at) : null,
          inspections,
          isDemo: Number(r.is_demo) === 1,
        };
      })
      .filter((item) => {
        if (qcStatus && item.qcStatus !== qcStatus) return false;
        if (
          search &&
          !item.batchCode.toLowerCase().includes(search) &&
          !item.producerName.toLowerCase().includes(search) &&
          !item.planCode.toLowerCase().includes(search)
        ) {
          return false;
        }
        return true;
      });

    res.json({ items });
  }
);

productionAndQcRouter.post(
  '/qc/shift/:batchId',
  requireAuth,
  requireRoles(RoleCode.QC_STAFF),
  (req: AuthedRequest, res) => {
    const batchId = Number(req.params.batchId);
    const grade = String(req.body?.grade || '').trim(); // 'Grade A' | 'Grade B'
    const inspectionResult =
      String(req.body?.inspectionResult || 'PASSED').trim() === 'NEEDS_REVIEW'
        ? 'NEEDS_REVIEW'
        : 'PASSED';
    const moistureNote = String(req.body?.moistureNote || '').trim();
    const durabilityNote = String(req.body?.durabilityNote || '').trim();
    const appearanceNote = String(req.body?.appearanceNote || '').trim();
    const foreignMatterNote = String(req.body?.foreignMatterNote || '').trim();
    const note = String(req.body?.note || '').trim();
    const evidenceAttachment = req.body?.evidenceAttachment as
      | { fileName: string; fileUrl: string; mimeType: string; fileSize: number }
      | undefined;

    if (!['Grade A', 'Grade B'].includes(grade)) {
      res.status(400).json({ error: 'Vui lòng chọn phân loại thành phẩm Grade A hoặc Grade B.' });
      return;
    }
    if (!evidenceAttachment?.fileUrl) {
      res.status(400).json({
        error: 'Vui lòng đính kèm hình ảnh bằng chứng kiểm tra QC theo ca.',
      });
      return;
    }

    try {
      withTransaction((txDb) => {
        const batch = txDb.prepare(`SELECT * FROM finished_batches WHERE id = ?`).get(batchId) as
          | Record<string, unknown>
          | undefined;
        if (!batch) throw new Error('NOT_FOUND');
        if (['IN_STOCK', 'DEPLETED'].includes(String(batch.warehouse_status))) {
          throw new Error('ALREADY_STOCKED');
        }

        const now = new Date().toISOString();
        const qcCode = generateCode(txDb, 'qc_inspections', 'QC-CA', now.slice(0, 10));
        const info = txDb
          .prepare(
            `INSERT INTO qc_inspections (
              code, inspection_type, batch_id, grade, inspection_result,
              moisture_note, durability_note, appearance_note, foreign_matter_note,
              note, inspector_id, inspected_at, is_demo
            ) VALUES (?, 'SHIFT_QC', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
          )
          .run(
            qcCode,
            batchId,
            grade,
            inspectionResult,
            moistureNote,
            durabilityNote,
            appearanceNote,
            foreignMatterNote,
            note,
            req.user!.id,
            now
          );
        const qcId = Number(info.lastInsertRowid);

        txDb
          .prepare(
            `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
             VALUES ('QC', ?, 'Ảnh kiểm tra QC theo ca', ?, ?, ?, ?, ?, ?)`
          )
          .run(
            qcId,
            evidenceAttachment.fileName,
            evidenceAttachment.fileUrl,
            evidenceAttachment.mimeType || 'image/jpeg',
            Number(evidenceAttachment.fileSize || 0),
            req.user!.id,
            now
          );

        const nextQcStatus = inspectionResult === 'PASSED' ? 'INSPECTED' : 'NEEDS_REVIEW';
        const nextWarehouseStatus =
          inspectionResult === 'PASSED' ? 'PENDING_RECEIPT' : 'PENDING_QC';

        txDb
          .prepare(
            `UPDATE finished_batches
             SET grade = ?, qc_status = ?, warehouse_status = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(grade, nextQcStatus, nextWarehouseStatus, now, batchId);

        writeAuditLog(txDb, {
          entityType: 'BATCH',
          entityId: batchId,
          action: `Hoàn tất QC theo ca (${grade})`,
          fromStatus: String(batch.qc_status),
          toStatus: nextQcStatus,
          referenceCode: String(batch.batch_code),
          actorId: req.user!.id,
          createdAt: now,
        });

        if (inspectionResult === 'PASSED') {
          notifyRoles(txDb, [RoleCode.WAREHOUSE_KEEPER], {
            dedupPrefix: `batch-wh-ready-${batchId}`,
            title: 'Thành phẩm chờ tiếp nhận kho',
            message: `Lô ${batch.batch_code} (${grade}, ${Number(batch.produced_kg).toLocaleString('vi-VN')} kg) đã hoàn tất QC, chờ Thủ kho tiếp nhận.`,
            targetPath: '/tiep-nhan-thanh-pham',
            referenceCode: String(batch.batch_code),
          });
        }
      });

      res.status(201).json({
        message: `Đã lưu kết quả QC theo ca (${grade}).`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NOT_FOUND') {
        res.status(404).json({ error: 'Không tìm thấy lô thành phẩm.' });
      } else if (msg === 'ALREADY_STOCKED') {
        res.status(400).json({ error: 'Lô đã nhập kho thành phẩm, không thể ghi đè QC theo ca.' });
      } else {
        res.status(500).json({ error: 'Không thể lưu kết quả QC theo ca.' });
      }
    }
  }
);

// Warehouse Keeper confirms receipt of Finished Goods Batch -> increases available_kg ONCE!
productionAndQcRouter.post(
  '/warehouse/finished-receipts/:batchId',
  requireAuth,
  requireRoles(RoleCode.WAREHOUSE_KEEPER),
  (req: AuthedRequest, res) => {
    const batchId = Number(req.params.batchId);
    const receivedKg = Number(req.body?.receivedKg);
    const packagingInfo = String(req.body?.packagingInfo || 'Bao Jumbo').trim();

    if (!Number.isFinite(receivedKg) || receivedKg <= 0) {
      res.status(400).json({ error: 'Khối lượng thực nhận thành phẩm phải lớn hơn 0.' });
      return;
    }

    try {
      withTransaction((txDb) => {
        const batch = txDb.prepare(`SELECT * FROM finished_batches WHERE id = ?`).get(batchId) as
          | Record<string, unknown>
          | undefined;
        if (!batch) throw new Error('NOT_FOUND');
        if (String(batch.warehouse_status) === 'IN_STOCK' || String(batch.warehouse_status) === 'DEPLETED') {
          throw new Error('ALREADY_RECEIVED');
        }
        if (String(batch.qc_status) !== 'INSPECTED' || String(batch.warehouse_status) !== 'PENDING_RECEIPT') {
          throw new Error('QC_NOT_READY');
        }

        const now = new Date().toISOString();
        txDb
          .prepare(
            `UPDATE finished_batches
             SET initial_kg = ?, available_kg = ?, warehouse_status = 'IN_STOCK',
                 packaging_info = ?, received_by = ?, received_at = ?, updated_at = ?
             WHERE id = ? AND warehouse_status = 'PENDING_RECEIPT'`
          )
          .run(receivedKg, receivedKg, packagingInfo, req.user!.id, now, now, batchId);

        const txCode = `NK-TP-${String(batchId).padStart(4, '0')}`;
        txDb
          .prepare(
            `INSERT INTO finished_goods_ledger (
              tx_code, batch_id, batch_code, tx_type, quantity_kg, balance_after_kg,
              reference_type, reference_id, reference_code, note, actor_id, is_demo, created_at
            ) VALUES (?, ?, ?, 'IN', ?, ?, 'SHIFT_REPORT', ?, ?, ?, ?, 0, ?)`
          )
          .run(
            txCode,
            batchId,
            String(batch.batch_code),
            receivedKg,
            receivedKg,
            Number(batch.shift_report_id),
            String(batch.batch_code),
            `Thủ kho xác nhận tiếp nhận lô ${batch.batch_code} (${packagingInfo})`,
            req.user!.id,
            now
          );

        writeAuditLog(txDb, {
          entityType: 'BATCH',
          entityId: batchId,
          action: `Tiếp nhận nhập kho thành phẩm (${receivedKg.toLocaleString('vi-VN')} kg)`,
          fromStatus: 'PENDING_RECEIPT',
          toStatus: 'IN_STOCK',
          referenceCode: String(batch.batch_code),
          actorId: req.user!.id,
          createdAt: now,
        });
      });

      res.json({ message: 'Đã tiếp nhận lô thành phẩm vào kho.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NOT_FOUND') {
        res.status(404).json({ error: 'Không tìm thấy lô thành phẩm.' });
      } else if (msg === 'ALREADY_RECEIVED') {
        res.status(409).json({ error: 'Lô thành phẩm này đã được tiếp nhận vào kho trước đó.' });
      } else if (msg === 'QC_NOT_READY') {
        res.status(400).json({ error: 'Lô thành phẩm chưa hoàn tất kiểm tra QC hợp lệ.' });
      } else {
        res.status(500).json({ error: 'Không thể tiếp nhận thành phẩm.' });
      }
    }
  }
);

// Finished Goods Inventory List & Ledger
productionAndQcRouter.get(
  '/inventory/finished',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.WAREHOUSE_KEEPER, RoleCode.QC_STAFF),
  (req, res) => {
    const includeHistory = String(req.query.includeHistory || 'false') === 'true';
    const grade = String(req.query.grade || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT fb.*, u_prod.full_name as producerName
         FROM finished_batches fb
         JOIN users u_prod ON u_prod.id = fb.producer_id
         WHERE fb.warehouse_status IN ('IN_STOCK', 'DEPLETED')
         ORDER BY fb.production_date ASC, fb.id ASC`
      )
      .all() as Array<Record<string, unknown>>;

    const batches = rows
      .filter((r) => {
        if (!includeHistory && Number(r.available_kg) <= 0) return false;
        if (grade && String(r.grade) !== grade) return false;
        if (search && !String(r.batch_code).toLowerCase().includes(search)) return false;
        return true;
      })
      .map((r) => ({
        id: Number(r.id),
        batchCode: String(r.batch_code),
        productionDate: String(r.production_date),
        shift: String(r.shift),
        grade: String(r.grade || ''),
        initialKg: Number(r.initial_kg),
        dispatchedKg: Number(r.dispatched_kg),
        availableKg: Number(r.available_kg),
        qcStatus: String(r.qc_status),
        warehouseStatus: String(r.warehouse_status),
        packagingInfo: String(r.packaging_info || ''),
        producerName: String(r.producerName),
        isDemo: Number(r.is_demo) === 1,
      }));

    const ledger = db
      .prepare(
        `SELECT l.id, l.tx_code as txCode, l.batch_code as batchCode, l.tx_type as txType,
                l.quantity_kg as quantityKg, l.balance_after_kg as balanceAfterKg,
                l.reference_code as referenceCode, l.note, l.is_demo as isDemo, l.created_at as createdAt,
                u.full_name as actorName
         FROM finished_goods_ledger l
         JOIN users u ON u.id = l.actor_id
         ORDER BY l.id DESC`
      )
      .all();

    const totals = db
      .prepare(
        `SELECT
          COALESCE(SUM(available_kg), 0) as totalAvailableKg,
          COALESCE(SUM(CASE WHEN grade = 'Grade A' THEN available_kg ELSE 0 END), 0) as gradeAKg,
          COALESCE(SUM(CASE WHEN grade = 'Grade B' THEN available_kg ELSE 0 END), 0) as gradeBKg
         FROM finished_batches
         WHERE warehouse_status = 'IN_STOCK'`
      )
      .get() as Record<string, unknown>;

    res.json({
      summary: {
        totalAvailableKg: Number(totals.totalAvailableKg || 0),
        gradeAKg: Number(totals.gradeAKg || 0),
        gradeBKg: Number(totals.gradeBKg || 0),
      },
      batches,
      ledger,
    });
  }
);
