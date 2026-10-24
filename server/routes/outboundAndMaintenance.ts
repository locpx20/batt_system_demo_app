import { Router } from 'express';
import { getDb, withTransaction } from '../db.ts';
import { requireAuth, requireRoles, type AuthedRequest } from '../security.ts';
import { computeFifoProposal } from '../fifo.ts';
import {
  generateCode,
  getEntityAttachments,
  getEntityHistory,
  notifyRoles,
  notifyUser,
  writeAuditLog,
} from '../auditAndNotify.ts';
import { RoleCode } from '../../shared/types.ts';

export const outboundAndMaintenanceRouter = Router();

// ==================== OUTBOUND ORDERS, FIFO, OWNER APPROVAL & DISPATCH ====================
outboundAndMaintenanceRouter.post(
  '/outbound/fifo-preview',
  requireAuth,
  requireRoles(RoleCode.MANAGER, RoleCode.OWNER, RoleCode.WAREHOUSE_KEEPER),
  (req, res) => {
    const requestedKg = Number(req.body?.requestedKg || 0);
    const acceptedGrade = String(req.body?.acceptedGrade || 'Grade A').trim();
    if (!['Grade A', 'Grade B', 'Grade A & B'].includes(acceptedGrade)) {
      res.status(400).json({ error: 'Phân loại Grade không hợp lệ.' });
      return;
    }
    const db = getDb();
    const proposal = computeFifoProposal(db, Math.max(0, requestedKg), acceptedGrade);
    res.json({ proposal });
  }
);

outboundAndMaintenanceRouter.get(
  '/outbound',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.WAREHOUSE_KEEPER),
  (req: AuthedRequest, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT o.*,
                c.name as customerName, c.phone as customerPhone,
                u_mgr.full_name as managerName,
                u_own.full_name as ownerName
         FROM outbound_orders o
         JOIN customers c ON c.id = o.customer_id
         JOIN users u_mgr ON u_mgr.id = o.manager_id
         LEFT JOIN users u_own ON u_own.id = o.owner_id
         ORDER BY o.id DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const includePrice = req.user!.role === RoleCode.OWNER || req.user!.role === RoleCode.MANAGER;

    const allocStmt = db.prepare(
      `SELECT oa.batch_id as batchId, oa.allocated_kg as allocatedKg, oa.dispatched_kg as dispatchedKg,
              fb.batch_code as batchCode, fb.production_date as productionDate, fb.shift,
              fb.grade as shiftGrade, fb.available_kg as batchAvailableKg
       FROM outbound_allocations oa
       JOIN finished_batches fb ON fb.id = oa.batch_id
       WHERE oa.outbound_order_id = ?
       ORDER BY fb.production_date ASC, fb.id ASC`
    );

    const items = rows
      .filter((r) => {
        if (status && String(r.status) !== status) return false;
        if (
          search &&
          !String(r.code).toLowerCase().includes(search) &&
          !String(r.customerName).toLowerCase().includes(search)
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
        customerPhone: String(r.customerPhone || ''),
        productName: String(r.product_name),
        requestedKg: Number(r.requested_kg),
        dispatchedKg: Number(r.dispatched_kg),
        remainingKg: Math.max(0, Math.round((Number(r.requested_kg) - Number(r.dispatched_kg)) * 100) / 100),
        acceptedGrade: String(r.accepted_grade),
        unitPrice: includePrice ? Number(r.unit_price) : null,
        totalValue: includePrice ? Number(r.total_value) : null,
        expectedDate: String(r.expected_date),
        note: String(r.note || ''),
        managerName: String(r.managerName),
        ownerName: r.ownerName ? String(r.ownerName) : null,
        ownerDecisionAt: r.owner_decision_at ? String(r.owner_decision_at) : null,
        ownerReason: r.owner_reason ? String(r.owner_reason) : null,
        recipientName: String(r.recipient_name || ''),
        recipientPhone: String(r.recipient_phone || ''),
        vehiclePlate: String(r.vehicle_plate || ''),
        deliveryNote: String(r.delivery_note || ''),
        status: String(r.status),
        allocations: allocStmt.all(Number(r.id)),
        isDemo: Number(r.is_demo) === 1,
        createdAt: String(r.created_at),
      }));

    res.json({ items });
  }
);

outboundAndMaintenanceRouter.get(
  '/outbound/:id',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.WAREHOUSE_KEEPER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const r = db
      .prepare(
        `SELECT o.*, c.name as customerName, c.phone as customerPhone, c.address as customerAddress,
                u_mgr.full_name as managerName, u_own.full_name as ownerName
         FROM outbound_orders o
         JOIN customers c ON c.id = o.customer_id
         JOIN users u_mgr ON u_mgr.id = o.manager_id
         LEFT JOIN users u_own ON u_own.id = o.owner_id
         WHERE o.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!r) {
      res.status(404).json({ error: 'Không tìm thấy yêu cầu xuất hàng.' });
      return;
    }

    const includePrice = req.user!.role === RoleCode.OWNER || req.user!.role === RoleCode.MANAGER;

    const allocations = db
      .prepare(
        `SELECT oa.id, oa.batch_id as batchId, oa.allocated_kg as allocatedKg, oa.dispatched_kg as dispatchedKg,
                fb.batch_code as batchCode, fb.production_date as productionDate, fb.shift,
                fb.grade as shiftGrade, fb.available_kg as batchAvailableKg,
                (SELECT q.code FROM qc_inspections q WHERE q.batch_id = fb.id AND q.inspection_type = 'SHIFT_QC' ORDER BY q.id DESC LIMIT 1) as shiftQcCode,
                (SELECT q.moisture_note FROM qc_inspections q WHERE q.batch_id = fb.id AND q.inspection_type = 'SHIFT_QC' ORDER BY q.id DESC LIMIT 1) as shiftMoistureNote,
                (SELECT q.appearance_note FROM qc_inspections q WHERE q.batch_id = fb.id AND q.inspection_type = 'SHIFT_QC' ORDER BY q.id DESC LIMIT 1) as shiftAppearanceNote
         FROM outbound_allocations oa
         JOIN finished_batches fb ON fb.id = oa.batch_id
         WHERE oa.outbound_order_id = ?
         ORDER BY fb.production_date ASC, fb.id ASC`
      )
      .all(id) as Array<Record<string, unknown>>;

    const shiftQcRaw = db
      .prepare(
        `SELECT q.*, fb.batch_code as batchCode, fb.production_date as productionDate, fb.shift, u.full_name as inspectorName
         FROM qc_inspections q
         JOIN finished_batches fb ON fb.id = q.batch_id
         JOIN users u ON u.id = q.inspector_id
         WHERE q.inspection_type = 'SHIFT_QC'
           AND q.batch_id IN (SELECT batch_id FROM outbound_allocations WHERE outbound_order_id = ?)
         ORDER BY fb.production_date ASC, q.id DESC`
      )
      .all(id) as Array<Record<string, unknown>>;

    const shiftQcInspections = shiftQcRaw.map((q) => ({
      id: Number(q.id),
      code: String(q.code),
      batchId: Number(q.batch_id),
      batchCode: String(q.batchCode),
      productionDate: String(q.productionDate),
      shift: String(q.shift),
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
    }));

    const dispatches = db
      .prepare(
        `SELECT d.*, fb.batch_code as batchCode, u.full_name as warehouseKeeperName
         FROM outbound_dispatches d
         JOIN finished_batches fb ON fb.id = d.batch_id
         JOIN users u ON u.id = d.warehouse_keeper_id
         WHERE d.outbound_order_id = ?
         ORDER BY d.id DESC`
      )
      .all(id);

    res.json({
      order: {
        id: Number(r.id),
        code: String(r.code),
        customerId: Number(r.customer_id),
        customerName: String(r.customerName),
        customerPhone: String(r.customerPhone || ''),
        customerAddress: String(r.customerAddress || ''),
        productName: String(r.product_name),
        requestedKg: Number(r.requested_kg),
        dispatchedKg: Number(r.dispatched_kg),
        remainingKg: Math.max(0, Math.round((Number(r.requested_kg) - Number(r.dispatched_kg)) * 100) / 100),
        acceptedGrade: String(r.accepted_grade),
        unitPrice: includePrice ? Number(r.unit_price) : null,
        totalValue: includePrice ? Number(r.total_value) : null,
        expectedDate: String(r.expected_date),
        note: String(r.note || ''),
        managerName: String(r.managerName),
        ownerName: r.ownerName ? String(r.ownerName) : null,
        ownerDecisionAt: r.owner_decision_at ? String(r.owner_decision_at) : null,
        ownerReason: r.owner_reason ? String(r.owner_reason) : null,
        recipientName: String(r.recipient_name || ''),
        recipientPhone: String(r.recipient_phone || ''),
        vehiclePlate: String(r.vehicle_plate || ''),
        deliveryNote: String(r.delivery_note || ''),
        status: String(r.status),
        isDemo: Number(r.is_demo) === 1,
      },
      allocations,
      shiftQcInspections,
      dispatches,
      attachments: getEntityAttachments(db, 'OUTBOUND', id),
      history: getEntityHistory(db, 'OUTBOUND', id),
    });
  }
);

// Manager creates Outbound Order -> validates FIFO stock (already Shift-QC inspected), submits directly to OWNER, DOES NOT deduct stock!
outboundAndMaintenanceRouter.post(
  '/outbound',
  requireAuth,
  requireRoles(RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const customerId = Number(req.body?.customerId);
    const requestedKg = Number(req.body?.requestedKg);
    const acceptedGrade = String(req.body?.acceptedGrade || '').trim();
    const unitPrice = Number(req.body?.unitPrice);
    const expectedDate = String(req.body?.expectedDate || '').trim();
    const note = String(req.body?.note || '').trim();

    if (
      !customerId ||
      !Number.isFinite(requestedKg) ||
      requestedKg <= 0 ||
      !['Grade A', 'Grade B', 'Grade A & B'].includes(acceptedGrade) ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0 ||
      !expectedDate
    ) {
      res.status(400).json({
        error: 'Vui lòng nhập đầy đủ khách hàng, khối lượng > 0, Grade yêu cầu, giá bán và ngày dự kiến.',
      });
      return;
    }

    try {
      const created = withTransaction((txDb) => {
        const cust = txDb.prepare(`SELECT * FROM customers WHERE id = ?`).get(customerId) as
          | Record<string, unknown>
          | undefined;
        if (!cust || String(cust.status) !== 'ACTIVE') {
          throw new Error('INVALID_CUSTOMER');
        }

        const fifo = computeFifoProposal(txDb, requestedKg, acceptedGrade);
        if (!fifo.isSufficient) {
          throw new Error(`SHORTAGE:${fifo.shortageKg}:${fifo.totalAllocatableKg}`);
        }

        const now = new Date().toISOString();
        const code = generateCode(txDb, 'outbound_orders', 'XH', expectedDate);
        const totalValue = Math.round(requestedKg * unitPrice);

        const info = txDb
          .prepare(
            `INSERT INTO outbound_orders (
              code, customer_id, product_name, requested_kg, accepted_grade, unit_price, total_value,
              expected_date, note, manager_id, has_qc_discrepancy, status, is_demo, created_at, updated_at
            ) VALUES (?, ?, 'Viên gỗ nén', ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING_OWNER', 0, ?, ?)`
          )
          .run(
            code,
            customerId,
            requestedKg,
            acceptedGrade,
            unitPrice,
            totalValue,
            expectedDate,
            note,
            req.user!.id,
            now,
            now
          );
        const orderId = Number(info.lastInsertRowid);

        const insAlloc = txDb.prepare(
          `INSERT INTO outbound_allocations (outbound_order_id, batch_id, allocated_kg, dispatched_kg)
           VALUES (?, ?, ?, 0)`
        );
        for (const a of fifo.allocations) {
          if (a.proposedKg > 0) {
            insAlloc.run(orderId, a.batchId, a.proposedKg);
          }
        }

        writeAuditLog(txDb, {
          entityType: 'OUTBOUND',
          entityId: orderId,
          action: `Tạo yêu cầu xuất hàng theo FIFO (${requestedKg.toLocaleString('vi-VN')} kg ${acceptedGrade}) & trình Chủ doanh nghiệp`,
          toStatus: 'PENDING_OWNER',
          referenceCode: code,
          actorId: req.user!.id,
          createdAt: now,
        });

        notifyRoles(txDb, [RoleCode.OWNER], {
          dedupPrefix: `outbound-submit-owner-${orderId}`,
          title: 'Yêu cầu xuất hàng chờ quyết định',
          message: `Đơn xuất ${code} (${requestedKg.toLocaleString('vi-VN')} kg ${acceptedGrade}) theo đề xuất FIFO đang chờ Chủ doanh nghiệp phê duyệt.`,
          targetPath: '/duyet-xuat-hang',
          referenceCode: code,
        });

        return { id: orderId, code };
      });

      res.status(201).json({
        message: `Đã tạo yêu cầu xuất hàng ${created.code} theo đề xuất FIFO và trình Chủ doanh nghiệp duyệt.`,
        ...created,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'INVALID_CUSTOMER') {
        res.status(400).json({ error: 'Khách hàng không hợp lệ hoặc đã ngừng sử dụng.' });
      } else if (msg.startsWith('SHORTAGE:')) {
        const [, shortStr, availStr] = msg.split(':');
        res.status(400).json({
          error: `Tồn kho khả dụng đúng phân loại ${acceptedGrade} chỉ còn ${Number(availStr).toLocaleString('vi-VN')} kg. Còn thiếu ${Number(shortStr).toLocaleString('vi-VN')} kg.`,
        });
      } else {
        res.status(500).json({ error: 'Không thể tạo yêu cầu xuất hàng.' });
      }
    }
  }
);

// OWNER ONLY: Final Outbound Decision (APPROVE | REJECT) -> NEVER deducts stock!
outboundAndMaintenanceRouter.post(
  '/outbound/:id/owner-decision',
  requireAuth,
  requireRoles(RoleCode.OWNER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const decision = String(req.body?.decision || '').trim(); // 'APPROVE' | 'REJECT'
    const reason = String(req.body?.reason || '').trim();

    if (!['APPROVE', 'REJECT'].includes(decision)) {
      res.status(400).json({ error: 'Quyết định xử lý không hợp lệ.' });
      return;
    }
    if (decision === 'REJECT' && !reason) {
      res.status(400).json({
        error: 'Vui lòng nhập lý do khi từ chối yêu cầu xuất hàng.',
      });
      return;
    }

    try {
      withTransaction((txDb) => {
        const order = txDb.prepare(`SELECT * FROM outbound_orders WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!order) throw new Error('NOT_FOUND');
        if (String(order.status) !== 'PENDING_OWNER') throw new Error('INVALID_STATE');

        const now = new Date().toISOString();
        const nextStatus = decision === 'APPROVE' ? 'OWNER_APPROVED' : 'REJECTED';

        txDb
          .prepare(
            `UPDATE outbound_orders
             SET status = ?, owner_id = ?, owner_decision_at = ?, owner_reason = ?, updated_at = ?
             WHERE id = ? AND status = 'PENDING_OWNER'`
          )
          .run(nextStatus, req.user!.id, now, reason || null, now, id);

        const actionLabel =
          decision === 'APPROVE'
            ? 'Chủ doanh nghiệp duyệt xuất hàng'
            : 'Chủ doanh nghiệp từ chối xuất hàng';

        writeAuditLog(txDb, {
          entityType: 'OUTBOUND',
          entityId: id,
          action: actionLabel,
          fromStatus: 'PENDING_OWNER',
          toStatus: nextStatus,
          reason: reason || null,
          referenceCode: String(order.code),
          actorId: req.user!.id,
          createdAt: now,
        });

        if (decision === 'APPROVE') {
          notifyUser(txDb, {
            userId: Number(order.manager_id),
            dedupKey: `owner-app-mgr-${id}-${now}`,
            title: 'Đơn xuất hàng đã được Chủ DN duyệt',
            message: `Đơn ${order.code} đã được duyệt. Vui lòng cập nhật người nhận và biển số xe để bàn giao.`,
            targetPath: '/yeu-cau-xuat-hang',
            referenceCode: String(order.code),
          });
          notifyRoles(txDb, [RoleCode.WAREHOUSE_KEEPER], {
            dedupPrefix: `owner-app-wh-${id}-${now}`,
            title: 'Đơn xuất hàng mới được duyệt',
            message: `Đơn ${order.code} (${Number(order.requested_kg).toLocaleString('vi-VN')} kg) đã được Chủ doanh nghiệp duyệt xuất.`,
            targetPath: '/ban-giao-xuat-hang',
            referenceCode: String(order.code),
          });
        } else {
          notifyUser(txDb, {
            userId: Number(order.manager_id),
            dedupKey: `owner-rej-${id}-${now}`,
            title: 'Yêu cầu xuất hàng bị từ chối',
            message: `Đơn ${order.code} không được duyệt: ${reason}`,
            targetPath: '/yeu-cau-xuat-hang',
            referenceCode: String(order.code),
          });
        }
      });

      res.json({
        message:
          decision === 'APPROVE'
            ? 'Đã duyệt yêu cầu xuất hàng. Chờ Quản lý xưởng cập nhật thông tin bàn giao.'
            : 'Đã từ chối yêu cầu xuất hàng.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NOT_FOUND') {
        res.status(404).json({ error: 'Không tìm thấy yêu cầu xuất hàng.' });
      } else {
        res.status(400).json({ error: 'Yêu cầu xuất hàng không ở trạng thái chờ Chủ doanh nghiệp quyết định.' });
      }
    }
  }
);

// Manager updates Recipient & Vehicle info after Owner approves
outboundAndMaintenanceRouter.put(
  '/outbound/:id/recipient',
  requireAuth,
  requireRoles(RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const recipientName = String(req.body?.recipientName || '').trim();
    const recipientPhone = String(req.body?.recipientPhone || '').trim();
    const vehiclePlate = String(req.body?.vehiclePlate || '').trim().toUpperCase();
    const deliveryNote = String(req.body?.deliveryNote || '').trim();

    if (!recipientName || !recipientPhone || !vehiclePlate) {
      res.status(400).json({
        error: 'Vui lòng nhập đầy đủ họ tên người nhận, số điện thoại và biển số phương tiện.',
      });
      return;
    }

    const db = getDb();
    const order = db.prepare(`SELECT * FROM outbound_orders WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!order) {
      res.status(404).json({ error: 'Không tìm thấy yêu cầu xuất hàng.' });
      return;
    }
    if (!['OWNER_APPROVED', 'READY_DISPATCH', 'PARTIALLY_DISPATCHED'].includes(String(order.status))) {
      res.status(400).json({
        error: 'Chỉ được cập nhật thông tin bàn giao sau khi Chủ doanh nghiệp đã duyệt xuất hàng.',
      });
      return;
    }

    const nextStatus =
      String(order.status) === 'PARTIALLY_DISPATCHED' ? 'PARTIALLY_DISPATCHED' : 'READY_DISPATCH';

    withTransaction((txDb) => {
      const now = new Date().toISOString();
      txDb
        .prepare(
          `UPDATE outbound_orders
           SET recipient_name = ?, recipient_phone = ?, vehicle_plate = ?, delivery_note = ?,
               status = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(recipientName, recipientPhone, vehiclePlate, deliveryNote, nextStatus, now, id);

      writeAuditLog(txDb, {
        entityType: 'OUTBOUND',
        entityId: id,
        action: `Cập nhật thông tin nhận hàng (${recipientName} - ${vehiclePlate})`,
        fromStatus: String(order.status),
        toStatus: nextStatus,
        referenceCode: String(order.code),
        actorId: req.user!.id,
        createdAt: now,
      });

      notifyRoles(txDb, [RoleCode.WAREHOUSE_KEEPER], {
        dedupPrefix: `outbound-ready-wh-${id}-${now}`,
        title: 'Yêu cầu bàn giao xuất hàng',
        message: `Đơn ${order.code} đã có thông tin xe ${vehiclePlate} (${recipientName}), sẵn sàng bàn giao thực tế.`,
        targetPath: '/ban-giao-xuat-hang',
        referenceCode: String(order.code),
      });
    });

    res.json({ message: 'Đã cập nhật thông tin người nhận và phương tiện bàn giao.' });
  }
);

// WAREHOUSE KEEPER ONLY: Confirm Actual Handover -> ONLY step that deducts Finished Goods inventory!
outboundAndMaintenanceRouter.post(
  '/outbound/:id/dispatch',
  requireAuth,
  requireRoles(RoleCode.WAREHOUSE_KEEPER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const note = String(req.body?.note || '').trim();

    if (lines.length === 0) {
      res.status(400).json({ error: 'Vui lòng nhập khối lượng thực tế bàn giao theo lô.' });
      return;
    }

    try {
      const outcome = withTransaction((txDb) => {
        const order = txDb.prepare(`SELECT * FROM outbound_orders WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!order) throw new Error('NOT_FOUND');
        if (!['READY_DISPATCH', 'PARTIALLY_DISPATCHED'].includes(String(order.status))) {
          throw new Error('NOT_READY_FOR_DISPATCH');
        }
        if (!String(order.recipient_name || '').trim() || !String(order.vehicle_plate || '').trim()) {
          throw new Error('MISSING_RECIPIENT_INFO');
        }

        const now = new Date().toISOString();
        let totalDispatchedThisTurn = 0;

        for (const line of lines) {
          const batchId = Number(line.batchId);
          const qty = Number(line.dispatchedKg);
          if (!Number.isFinite(qty) || qty <= 0) continue;

          const alloc = txDb
            .prepare(
              `SELECT * FROM outbound_allocations WHERE outbound_order_id = ? AND batch_id = ?`
            )
            .get(id, batchId) as Record<string, unknown> | undefined;
          if (!alloc) throw new Error('INVALID_BATCH_ALLOCATION');

          const remainingAlloc =
            Math.round((Number(alloc.allocated_kg) - Number(alloc.dispatched_kg)) * 100) / 100;
          if (qty > remainingAlloc) {
            throw new Error('EXCEEDS_ALLOCATION');
          }

          const batch = txDb.prepare(`SELECT * FROM finished_batches WHERE id = ?`).get(batchId) as
            | Record<string, unknown>
            | undefined;
          if (!batch || Number(batch.available_kg) < qty) {
            throw new Error('INSUFFICIENT_BATCH_STOCK');
          }

          const newBatchAvail = Math.round((Number(batch.available_kg) - qty) * 100) / 100;
          const newBatchDispatched = Math.round((Number(batch.dispatched_kg) + qty) * 100) / 100;
          const newWarehouseStatus = newBatchAvail === 0 ? 'DEPLETED' : 'IN_STOCK';

          txDb
            .prepare(
              `UPDATE finished_batches
               SET available_kg = ?, dispatched_kg = ?, warehouse_status = ?, updated_at = ?
               WHERE id = ? AND available_kg >= ?`
            )
            .run(newBatchAvail, newBatchDispatched, newWarehouseStatus, now, batchId, qty);

          txDb
            .prepare(
              `UPDATE outbound_allocations
               SET dispatched_kg = ROUND(dispatched_kg + ?, 2)
               WHERE id = ?`
            )
            .run(qty, Number(alloc.id));

          const dispatchCode = generateCode(txDb, 'outbound_dispatches', 'BG', now.slice(0, 10));
          txDb
            .prepare(
              `INSERT INTO outbound_dispatches (
                code, outbound_order_id, batch_id, dispatched_kg,
                recipient_name, recipient_phone, vehicle_plate, note,
                warehouse_keeper_id, dispatched_at, is_demo
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
            )
            .run(
              dispatchCode,
              id,
              batchId,
              qty,
              String(order.recipient_name),
              String(order.recipient_phone),
              String(order.vehicle_plate),
              note,
              req.user!.id,
              now
            );

          const ledgerCnt = txDb
            .prepare(`SELECT COUNT(*) as cnt FROM finished_goods_ledger WHERE tx_type = 'OUT'`)
            .get() as { cnt: number };
          const txCode = `XK-TP-${String(Number(ledgerCnt.cnt) + 1).padStart(3, '0')}`;

          txDb
            .prepare(
              `INSERT INTO finished_goods_ledger (
                tx_code, batch_id, batch_code, tx_type, quantity_kg, balance_after_kg,
                reference_type, reference_id, reference_code, note, actor_id, is_demo, created_at
              ) VALUES (?, ?, ?, 'OUT', ?, ?, 'OUTBOUND_DISPATCH', ?, ?, ?, ?, 0, ?)`
            )
            .run(
              txCode,
              batchId,
              String(batch.batch_code),
              qty,
              newBatchAvail,
              id,
              String(order.code),
              `Bàn giao thực tế đơn ${order.code} (Xe ${order.vehicle_plate})`,
              req.user!.id,
              now
            );

          totalDispatchedThisTurn = Math.round((totalDispatchedThisTurn + qty) * 100) / 100;
        }

        if (totalDispatchedThisTurn <= 0) {
          throw new Error('ZERO_DISPATCH');
        }

        const cumulativeDispatched =
          Math.round((Number(order.dispatched_kg) + totalDispatchedThisTurn) * 100) / 100;
        const requestedKg = Number(order.requested_kg);
        const nextStatus =
          cumulativeDispatched >= requestedKg ? 'DISPATCHED' : 'PARTIALLY_DISPATCHED';

        txDb
          .prepare(
            `UPDATE outbound_orders SET dispatched_kg = ?, status = ?, updated_at = ? WHERE id = ?`
          )
          .run(cumulativeDispatched, nextStatus, now, id);

        // Update / create Receivable strictly from actual dispatched weight * unit_price (paid_amount NOT assumed!)
        const actualSalesValue = Math.round(cumulativeDispatched * Number(order.unit_price));
        const existingRec = txDb
          .prepare(`SELECT * FROM receivables WHERE outbound_order_id = ?`)
          .get(id) as Record<string, unknown> | undefined;

        if (!existingRec) {
          const recCode = generateCode(txDb, 'receivables', 'CN-PTHU', now.slice(0, 10));
          txDb
            .prepare(
              `INSERT INTO receivables (
                code, customer_id, outbound_order_id, delivery_date,
                total_amount, paid_amount, remaining_amount, status, is_demo, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, 0, ?, 'UNPAID', 0, ?, ?)`
            )
            .run(
              recCode,
              Number(order.customer_id),
              id,
              now.slice(0, 10),
              actualSalesValue,
              actualSalesValue,
              now,
              now
            );
        } else {
          const paid = Number(existingRec.paid_amount);
          const rem = Math.max(0, actualSalesValue - paid);
          const recStatus = rem === 0 && actualSalesValue > 0 ? 'PAID' : paid > 0 ? 'PARTIAL_PAID' : 'UNPAID';
          txDb
            .prepare(
              `UPDATE receivables
               SET delivery_date = ?, total_amount = ?, remaining_amount = ?, status = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(now.slice(0, 10), actualSalesValue, rem, recStatus, now, Number(existingRec.id));
        }

        writeAuditLog(txDb, {
          entityType: 'OUTBOUND',
          entityId: id,
          action:
            nextStatus === 'DISPATCHED'
              ? `Xác nhận bàn giao hoàn tất (${totalDispatchedThisTurn.toLocaleString('vi-VN')} kg)`
              : `Xác nhận bàn giao một phần (${totalDispatchedThisTurn.toLocaleString('vi-VN')} kg — lũy kế ${cumulativeDispatched.toLocaleString('vi-VN')}/${requestedKg.toLocaleString('vi-VN')} kg)`,
          fromStatus: String(order.status),
          toStatus: nextStatus,
          referenceCode: String(order.code),
          actorId: req.user!.id,
          createdAt: now,
        });

        notifyRoles(txDb, [RoleCode.MANAGER, RoleCode.OWNER], {
          dedupPrefix: `outbound-disp-${id}-${cumulativeDispatched}`,
          title:
            nextStatus === 'DISPATCHED'
              ? 'Đã hoàn tất bàn giao xuất hàng'
              : 'Đã bàn giao xuất hàng một phần',
          message: `Đơn ${order.code}: vừa bàn giao thực tế ${totalDispatchedThisTurn.toLocaleString('vi-VN')} kg (lũy kế ${cumulativeDispatched.toLocaleString('vi-VN')}/${requestedKg.toLocaleString('vi-VN')} kg).`,
          targetPath: '/ban-giao-xuat-hang',
          referenceCode: String(order.code),
        });

        return { nextStatus, totalDispatchedThisTurn, cumulativeDispatched };
      });

      res.json({
        message:
          outcome.nextStatus === 'DISPATCHED'
            ? 'Đã xác nhận bàn giao hoàn tất và trừ tồn kho thành phẩm.'
            : 'Đã ghi nhận bàn giao một phần và cập nhật tồn kho thực tế.',
        ...outcome,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NOT_FOUND') {
        res.status(404).json({ error: 'Không tìm thấy yêu cầu xuất hàng.' });
      } else if (msg === 'NOT_READY_FOR_DISPATCH') {
        res.status(400).json({
          error: 'Đơn xuất chưa đủ điều kiện bàn giao thực tế (cần Chủ DN duyệt và Quản lý cập nhật thông tin xe).',
        });
      } else if (msg === 'MISSING_RECIPIENT_INFO') {
        res.status(400).json({
          error: 'Chưa có thông tin người nhận và biển số xe từ Quản lý xưởng.',
        });
      } else if (msg === 'EXCEEDS_ALLOCATION') {
        res.status(400).json({ error: 'Khối lượng bàn giao vượt lượng phân bổ còn lại của lô.' });
      } else if (msg === 'INSUFFICIENT_BATCH_STOCK') {
        res.status(400).json({ error: 'Tồn kho thực tế của lô không đủ để trừ.' });
      } else {
        res.status(400).json({ error: 'Vui lòng nhập khối lượng bàn giao hợp lệ lớn hơn 0.' });
      }
    }
  }
);

// ==================== MACHINE INCIDENTS & MAINTENANCE ====================
outboundAndMaintenanceRouter.get(
  '/maintenance/requests',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.STAFF, RoleCode.MAINTENANCE_STAFF),
  (req: AuthedRequest, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const db = getDb();

    let whereSql = '';
    const params: Array<number | string> = [];
    if (req.user!.role === RoleCode.STAFF) {
      whereSql = `WHERE mr.requested_by = ?`;
      params.push(req.user!.id);
    } else if (req.user!.role === RoleCode.MAINTENANCE_STAFF) {
      whereSql = `WHERE mr.assigned_to = ?`;
      params.push(req.user!.id);
    }

    const rows = db
      .prepare(
        `SELECT mr.*,
                m.code as machineCode, m.name as machineName,
                u_req.full_name as requestedByName,
                u_mgr.full_name as assignedByName,
                u_tech.full_name as assignedToName
         FROM maintenance_requests mr
         JOIN machines m ON m.id = mr.machine_id
         JOIN users u_req ON u_req.id = mr.requested_by
         LEFT JOIN users u_mgr ON u_mgr.id = mr.assigned_by
         LEFT JOIN users u_tech ON u_tech.id = mr.assigned_to
         ${whereSql}
         ORDER BY mr.id DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const items = rows
      .filter((r) => {
        if (status && String(r.status) !== status) return false;
        if (
          search &&
          !String(r.code).toLowerCase().includes(search) &&
          !String(r.machineName).toLowerCase().includes(search) &&
          !String(r.description).toLowerCase().includes(search)
        ) {
          return false;
        }
        return true;
      })
      .map((r) => ({
        id: Number(r.id),
        code: String(r.code),
        machineId: Number(r.machine_id),
        machineCode: String(r.machineCode),
        machineName: String(r.machineName),
        requestedBy: Number(r.requested_by),
        requestedByName: String(r.requestedByName),
        issueType: String(r.issue_type || ''),
        severity: String(r.severity || ''),
        description: String(r.description),
        assignedByName: r.assignedByName ? String(r.assignedByName) : null,
        assignedTo: r.assigned_to !== null ? Number(r.assigned_to) : null,
        assignedToName: r.assignedToName ? String(r.assignedToName) : null,
        assignedAt: r.assigned_at ? String(r.assigned_at) : null,
        assignmentNote: String(r.assignment_note || ''),
        repairResult: String(r.repair_result || ''),
        materialsUsed: String(r.materials_used || ''),
        completedWorkAt: r.completed_work_at ? String(r.completed_work_at) : null,
        repairNote: String(r.repair_note || ''),
        rejectReason: r.reject_reason ? String(r.reject_reason) : null,
        status: String(r.status),
        attachments: getEntityAttachments(db, 'MAINTENANCE', Number(r.id)),
        history: getEntityHistory(db, 'MAINTENANCE', Number(r.id)),
        isDemo: Number(r.is_demo) === 1,
        createdAt: String(r.created_at),
      }));

    res.json({ items });
  }
);

outboundAndMaintenanceRouter.post(
  '/maintenance/requests',
  requireAuth,
  requireRoles(RoleCode.STAFF, RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const machineId = Number(req.body?.machineId);
    const planId = req.body?.planId ? Number(req.body.planId) : null;
    const issueType = String(req.body?.issueType || 'Cơ khí').trim();
    const severity = String(req.body?.severity || 'Cần xử lý trong ca').trim();
    const description = String(req.body?.description || '').trim();
    const evidenceAttachment = req.body?.evidenceAttachment as
      | { fileName: string; fileUrl: string; mimeType: string; fileSize: number }
      | undefined;

    if (!machineId || !description) {
      res.status(400).json({ error: 'Vui lòng chọn máy gặp sự cố và nhập mô tả sự cố.' });
      return;
    }

    const created = withTransaction((txDb) => {
      const now = new Date().toISOString();
      const code = generateCode(txDb, 'maintenance_requests', 'BT', now.slice(0, 10));
      const info = txDb
        .prepare(
          `INSERT INTO maintenance_requests (
            code, machine_id, plan_id, requested_by, issue_type, severity, description, status, is_demo, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW_ISSUE', 0, ?, ?)`
        )
        .run(code, machineId, planId, req.user!.id, issueType, severity, description, now, now);
      const reqId = Number(info.lastInsertRowid);

      if (evidenceAttachment?.fileUrl) {
        txDb
          .prepare(
            `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
             VALUES ('MAINTENANCE', ?, 'Ảnh hiện trường sự cố', ?, ?, ?, ?, ?, ?)`
          )
          .run(
            reqId,
            evidenceAttachment.fileName,
            evidenceAttachment.fileUrl,
            evidenceAttachment.mimeType || 'image/jpeg',
            Number(evidenceAttachment.fileSize || 0),
            req.user!.id,
            now
          );
      }

      writeAuditLog(txDb, {
        entityType: 'MAINTENANCE',
        entityId: reqId,
        action: 'Gửi yêu cầu báo sự cố máy móc',
        toStatus: 'NEW_ISSUE',
        referenceCode: code,
        actorId: req.user!.id,
        createdAt: now,
      });

      notifyRoles(txDb, [RoleCode.MANAGER], {
        dedupPrefix: `maint-new-${reqId}`,
        title: 'Yêu cầu bảo trì mới',
        message: `Yêu cầu sửa chữa ${code} vừa được gửi, chờ tiếp nhận và phân công.`,
        targetPath: '/su-co-may-moc',
        referenceCode: code,
      });

      return { id: reqId, code };
    });

    res.status(201).json({ message: `Đã gửi yêu cầu bảo trì ${created.code}.`, ...created });
  }
);

// Manager receives & assigns Maintenance Staff in a single atomic operation
outboundAndMaintenanceRouter.post(
  '/maintenance/requests/:id/assign',
  requireAuth,
  requireRoles(RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const assignedTo = Number(req.body?.assignedTo);
    const assignmentNote = String(req.body?.assignmentNote || '').trim();

    if (!assignedTo) {
      res.status(400).json({ error: 'Vui lòng chọn nhân viên bảo trì thực hiện.' });
      return;
    }

    const db = getDb();
    const mr = db.prepare(`SELECT * FROM maintenance_requests WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!mr) {
      res.status(404).json({ error: 'Không tìm thấy yêu cầu bảo trì.' });
      return;
    }
    if (!['NEW_ISSUE', 'ASSIGNED'].includes(String(mr.status))) {
      res.status(400).json({ error: 'Yêu cầu bảo trì đã chuyển sang bước thực hiện.' });
      return;
    }

    const tech = db.prepare(`SELECT * FROM users WHERE id = ?`).get(assignedTo) as
      | Record<string, unknown>
      | undefined;
    if (!tech || String(tech.status) !== 'ACTIVE' || String(tech.role) !== RoleCode.MAINTENANCE_STAFF) {
      res.status(400).json({ error: 'Người nhận việc phải là Nhân viên bảo trì đang hoạt động.' });
      return;
    }

    withTransaction((txDb) => {
      const now = new Date().toISOString();
      txDb
        .prepare(
          `UPDATE maintenance_requests
           SET assigned_by = ?, assigned_to = ?, assigned_at = ?, assignment_note = ?, status = 'ASSIGNED', updated_at = ?
           WHERE id = ?`
        )
        .run(req.user!.id, assignedTo, now, assignmentNote, now, id);

      writeAuditLog(txDb, {
        entityType: 'MAINTENANCE',
        entityId: id,
        action: `Tiếp nhận & giao việc cho ${tech.full_name}`,
        fromStatus: String(mr.status),
        toStatus: 'ASSIGNED',
        referenceCode: String(mr.code),
        actorId: req.user!.id,
        createdAt: now,
      });

      notifyUser(txDb, {
        userId: assignedTo,
        dedupKey: `maint-assign-${id}-${now}`,
        title: 'Công việc bảo trì mới được giao',
        message: `Quản lý xưởng đã giao bạn xử lý yêu cầu ${mr.code}.`,
        targetPath: '/su-co-may-moc',
        referenceCode: String(mr.code),
      });
    });

    res.json({ message: 'Đã tiếp nhận và phân công nhân viên bảo trì.' });
  }
);

// Maintenance Staff starts or submits repair completion report (CANNOT self-confirm completion!)
outboundAndMaintenanceRouter.put(
  '/maintenance/requests/:id/progress',
  requireAuth,
  requireRoles(RoleCode.MAINTENANCE_STAFF),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const mode = String(req.body?.mode || 'REPORT').trim(); // 'START' | 'REPORT'
    const repairResult = String(req.body?.repairResult || '').trim();
    const materialsUsed = String(req.body?.materialsUsed || '').trim();
    const repairNote = String(req.body?.repairNote || '').trim();
    const evidenceAttachment = req.body?.evidenceAttachment as
      | { fileName: string; fileUrl: string; mimeType: string; fileSize: number }
      | undefined;

    const db = getDb();
    const mr = db.prepare(`SELECT * FROM maintenance_requests WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!mr) {
      res.status(404).json({ error: 'Không tìm thấy yêu cầu sửa chữa.' });
      return;
    }
    if (Number(mr.assigned_to) !== req.user!.id) {
      res.status(403).json({ error: 'Bạn chỉ được cập nhật công việc bảo trì được giao cho mình.' });
      return;
    }

    if (mode === 'START') {
      if (String(mr.status) !== 'ASSIGNED') {
        res.status(400).json({ error: 'Công việc không ở trạng thái chờ bắt đầu.' });
        return;
      }
      const now = new Date().toISOString();
      db.prepare(`UPDATE maintenance_requests SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?`).run(
        now,
        id
      );
      writeAuditLog(db, {
        entityType: 'MAINTENANCE',
        entityId: id,
        action: 'Bắt đầu thực hiện sửa chữa',
        fromStatus: 'ASSIGNED',
        toStatus: 'IN_PROGRESS',
        referenceCode: String(mr.code),
        actorId: req.user!.id,
        createdAt: now,
      });
      res.json({ message: 'Đã chuyển trạng thái sang Đang thực hiện sửa chữa.' });
      return;
    }

    if (!['ASSIGNED', 'IN_PROGRESS', 'REVISION_REQUIRED'].includes(String(mr.status))) {
      res.status(400).json({ error: 'Không thể gửi báo cáo ở trạng thái hiện tại.' });
      return;
    }
    if (!repairResult) {
      res.status(400).json({ error: 'Vui lòng nhập kết quả sửa chữa.' });
      return;
    }

    withTransaction((txDb) => {
      const now = new Date().toISOString();
      if (evidenceAttachment?.fileUrl) {
        txDb
          .prepare(
            `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
             VALUES ('MAINTENANCE', ?, 'Ảnh kết quả sửa chữa', ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            evidenceAttachment.fileName,
            evidenceAttachment.fileUrl,
            evidenceAttachment.mimeType || 'image/jpeg',
            Number(evidenceAttachment.fileSize || 0),
            req.user!.id,
            now
          );
      }

      txDb
        .prepare(
          `UPDATE maintenance_requests
           SET repair_result = ?, materials_used = ?, completed_work_at = ?, repair_note = ?,
               status = 'REPORTED', updated_at = ?
           WHERE id = ?`
        )
        .run(repairResult, materialsUsed, now, repairNote, now, id);

      writeAuditLog(txDb, {
        entityType: 'MAINTENANCE',
        entityId: id,
        action: 'Gửi báo cáo hoàn tất sửa chữa chờ xác nhận',
        fromStatus: String(mr.status),
        toStatus: 'REPORTED',
        referenceCode: String(mr.code),
        actorId: req.user!.id,
        createdAt: now,
      });

      notifyRoles(txDb, [RoleCode.MANAGER], {
        dedupPrefix: `maint-rep-${id}-${now}`,
        title: 'Báo cáo sửa chữa chờ xác nhận',
        message: `Nhân viên bảo trì đã gửi báo cáo hoàn tất cho yêu cầu ${mr.code}.`,
        targetPath: '/su-co-may-moc',
        referenceCode: String(mr.code),
      });
    });

    res.json({ message: 'Đã gửi báo cáo sửa chữa chờ Quản lý xưởng xác nhận.' });
  }
);

// Manager confirms or rejects Maintenance Repair Report
outboundAndMaintenanceRouter.post(
  '/maintenance/requests/:id/confirm',
  requireAuth,
  requireRoles(RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const decision = String(req.body?.decision || '').trim(); // 'CONFIRM' | 'REJECT'
    const reason = String(req.body?.reason || '').trim();

    if (!['CONFIRM', 'REJECT'].includes(decision)) {
      res.status(400).json({ error: 'Thao tác không hợp lệ.' });
      return;
    }
    if (decision === 'REJECT' && !reason) {
      res.status(400).json({ error: 'Vui lòng nhập lý do từ chối báo cáo sửa chữa.' });
      return;
    }

    const db = getDb();
    const mr = db.prepare(`SELECT * FROM maintenance_requests WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!mr) {
      res.status(404).json({ error: 'Không tìm thấy yêu cầu bảo trì.' });
      return;
    }
    if (Number(mr.assigned_to) === req.user!.id) {
      res.status(403).json({ error: 'Người sửa chữa không được tự xác nhận hoàn tất.' });
      return;
    }
    if (String(mr.status) !== 'REPORTED') {
      res.status(400).json({ error: 'Yêu cầu bảo trì chưa ở trạng thái chờ xác nhận báo cáo.' });
      return;
    }

    const nextStatus = decision === 'CONFIRM' ? 'COMPLETED' : 'REVISION_REQUIRED';
    withTransaction((txDb) => {
      const now = new Date().toISOString();
      txDb
        .prepare(
          `UPDATE maintenance_requests
           SET status = ?, confirmed_by = ?, confirmed_at = ?, reject_reason = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nextStatus, req.user!.id, now, decision === 'REJECT' ? reason : null, now, id);

      writeAuditLog(txDb, {
        entityType: 'MAINTENANCE',
        entityId: id,
        action:
          decision === 'CONFIRM'
            ? 'Xác nhận hoàn tất sửa chữa máy'
            : 'Từ chối nghiệm thu sửa chữa',
        fromStatus: 'REPORTED',
        toStatus: nextStatus,
        reason: decision === 'REJECT' ? reason : null,
        referenceCode: String(mr.code),
        actorId: req.user!.id,
        createdAt: now,
      });

      if (mr.assigned_to) {
        notifyUser(txDb, {
          userId: Number(mr.assigned_to),
          dedupKey: `maint-conf-${id}-${now}`,
          title:
            decision === 'CONFIRM'
              ? 'Đã xác nhận hoàn tất sửa chữa'
              : 'Báo cáo sửa chữa cần bổ sung',
          message:
            decision === 'CONFIRM'
              ? `Quản lý xưởng đã xác nhận hoàn tất yêu cầu ${mr.code}.`
              : `Yêu cầu ${mr.code} cần kiểm tra lại: ${reason}`,
          targetPath: '/su-co-may-moc',
          referenceCode: String(mr.code),
        });
      }
    });

    res.json({
      message:
        decision === 'CONFIRM'
          ? 'Đã xác nhận hoàn tất công việc sửa chữa.'
          : 'Đã trả lại báo cáo sửa chữa kèm lý do.',
    });
  }
);

// ==================== MAINTENANCE SPARE PART REQUESTS (INDEPENDENT ITEM APPROVAL) ====================
outboundAndMaintenanceRouter.get(
  '/maintenance/spare-parts',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.MAINTENANCE_STAFF),
  (req: AuthedRequest, res) => {
    const db = getDb();
    let whereSql = '';
    const params: Array<number> = [];
    if (req.user!.role === RoleCode.MAINTENANCE_STAFF) {
      whereSql = `WHERE sp.requested_by = ?`;
      params.push(req.user!.id);
    }

    const requests = db
      .prepare(
        `SELECT sp.*, mr.code as maintenanceCode, u.full_name as requestedByName
         FROM spare_part_requests sp
         LEFT JOIN maintenance_requests mr ON mr.id = sp.maintenance_request_id
         JOIN users u ON u.id = sp.requested_by
         ${whereSql}
         ORDER BY sp.id DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const itemStmt = db.prepare(
      `SELECT i.id, i.item_name as itemName, i.quantity, i.unit, i.spec_note as specNote,
              i.status, i.decision_reason as decisionReason, i.reviewed_at as reviewedAt,
              u.full_name as reviewedByName
       FROM spare_part_items i
       LEFT JOIN users u ON u.id = i.reviewed_by
       WHERE i.spare_part_request_id = ?
       ORDER BY i.id ASC`
    );

    const items = requests.map((r) => ({
      id: Number(r.id),
      code: String(r.code),
      maintenanceRequestId: r.maintenance_request_id !== null ? Number(r.maintenance_request_id) : null,
      maintenanceCode: r.maintenanceCode ? String(r.maintenanceCode) : null,
      requestedByName: String(r.requestedByName),
      note: String(r.note || ''),
      lineItems: itemStmt.all(Number(r.id)),
      isDemo: Number(r.is_demo) === 1,
      createdAt: String(r.created_at),
    }));

    res.json({ items });
  }
);

outboundAndMaintenanceRouter.post(
  '/maintenance/spare-parts',
  requireAuth,
  requireRoles(RoleCode.MAINTENANCE_STAFF),
  (req: AuthedRequest, res) => {
    const maintenanceRequestId = req.body?.maintenanceRequestId
      ? Number(req.body.maintenanceRequestId)
      : null;
    const note = String(req.body?.note || '').trim();
    const lineItems = Array.isArray(req.body?.lineItems) ? req.body.lineItems : [];

    if (lineItems.length === 0) {
      res.status(400).json({ error: 'Vui lòng thêm ít nhất một mặt hàng vật tư bảo trì.' });
      return;
    }
    for (const item of lineItems) {
      if (!String(item.itemName || '').trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
        res.status(400).json({ error: 'Mỗi vật tư phải có tên mặt hàng và số lượng lớn hơn 0.' });
        return;
      }
    }

    const created = withTransaction((txDb) => {
      const now = new Date().toISOString();
      const code = generateCode(txDb, 'spare_part_requests', 'VT', now.slice(0, 10));
      const info = txDb
        .prepare(
          `INSERT INTO spare_part_requests (code, maintenance_request_id, requested_by, note, is_demo, created_at)
           VALUES (?, ?, ?, ?, 0, ?)`
        )
        .run(code, maintenanceRequestId, req.user!.id, note, now);
      const spId = Number(info.lastInsertRowid);

      const insItem = txDb.prepare(
        `INSERT INTO spare_part_items (spare_part_request_id, item_name, quantity, unit, spec_note, status)
         VALUES (?, ?, ?, ?, ?, 'PENDING')`
      );
      for (const item of lineItems) {
        insItem.run(
          spId,
          String(item.itemName).trim(),
          Number(item.quantity),
          String(item.unit || 'cái').trim(),
          String(item.specNote || '').trim()
        );
      }

      notifyRoles(txDb, [RoleCode.MANAGER], {
        dedupPrefix: `sp-req-${spId}`,
        title: 'Yêu cầu vật tư bảo trì mới',
        message: `Phiếu đề xuất vật tư ${code} (${lineItems.length} mặt hàng) đang chờ duyệt từng hạng mục.`,
        targetPath: '/vat-tu-bao-tri',
        referenceCode: code,
      });

      return { id: spId, code };
    });

    res.status(201).json({ message: `Đã gửi phiếu yêu cầu vật tư ${created.code}.`, ...created });
  }
);

// Manager approves or rejects EACH spare part item independently!
outboundAndMaintenanceRouter.put(
  '/maintenance/spare-part-items/:itemId/decision',
  requireAuth,
  requireRoles(RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const itemId = Number(req.params.itemId);
    const decision = String(req.body?.decision || '').trim(); // 'APPROVED' | 'REJECTED'
    const reason = String(req.body?.reason || '').trim();

    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      res.status(400).json({ error: 'Quyết định duyệt vật tư không hợp lệ.' });
      return;
    }
    if (decision === 'REJECTED' && !reason) {
      res.status(400).json({ error: 'Vui lòng nhập lý do từ chối hạng mục vật tư.' });
      return;
    }

    const db = getDb();
    const item = db
      .prepare(
        `SELECT i.*, sp.code as requestCode, sp.requested_by as requestedBy
         FROM spare_part_items i
         JOIN spare_part_requests sp ON sp.id = i.spare_part_request_id
         WHERE i.id = ?`
      )
      .get(itemId) as Record<string, unknown> | undefined;

    if (!item) {
      res.status(404).json({ error: 'Không tìm thấy mặt hàng vật tư.' });
      return;
    }
    if (String(item.status) !== 'PENDING') {
      res.status(400).json({ error: 'Mặt hàng này đã được xử lý phê duyệt trước đó.' });
      return;
    }

    withTransaction((txDb) => {
      const now = new Date().toISOString();
      txDb
        .prepare(
          `UPDATE spare_part_items
           SET status = ?, reviewed_by = ?, reviewed_at = ?, decision_reason = ?
           WHERE id = ?`
        )
        .run(decision, req.user!.id, now, reason || null, itemId);

      notifyUser(txDb, {
        userId: Number(item.requestedBy),
        dedupKey: `sp-item-${itemId}-${decision}`,
        title: 'Cập nhật duyệt vật tư bảo trì',
        message: `Hạng mục "${item.item_name}" (${item.requestCode}): ${decision === 'APPROVED' ? 'Đã duyệt' : `Từ chối (${reason})`}.`,
        targetPath: '/vat-tu-bao-tri',
        referenceCode: String(item.requestCode),
      });
    });

    res.json({
      message:
        decision === 'APPROVED'
          ? 'Đã duyệt mặt hàng vật tư độc lập.'
          : 'Đã từ chối mặt hàng vật tư.',
    });
  }
);
