import { Router } from 'express';
import { getDb, withTransaction } from '../db.ts';
import { requireAuth, requireRoles, type AuthedRequest } from '../security.ts';
import {
  generateCode,
  getEntityAttachments,
  getEntityHistory,
  notifyRoles,
  notifyUser,
  writeAuditLog,
} from '../auditAndNotify.ts';
import { RoleCode } from '../../shared/types.ts';

export const partnersAndPurchasingRouter = Router();

// ==================== SUPPLIERS ====================
partnersAndPurchasingRouter.get(
  '/suppliers',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER),
  (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT s.*,
          COUNT(po.id) as orderCount,
          COALESCE(SUM(CASE WHEN po.status = 'RECEIVED' THEN po.received_kg ELSE 0 END), 0) as totalReceivedKg,
          COALESCE(SUM(CASE WHEN po.status = 'RECEIVED' AND po.unit_price IS NOT NULL THEN po.received_kg * po.unit_price ELSE 0 END), 0) as totalPurchaseValue
         FROM suppliers s
         LEFT JOIN purchasing_orders po ON po.supplier_id = s.id
         GROUP BY s.id
         ORDER BY s.name ASC`
      )
      .all() as Array<Record<string, unknown>>;

    const items = rows
      .filter((r) => {
        if (status && String(r.status) !== status) return false;
        if (
          search &&
          !String(r.name).toLowerCase().includes(search) &&
          !String(r.code).toLowerCase().includes(search) &&
          !String(r.phone).toLowerCase().includes(search)
        ) {
          return false;
        }
        return true;
      })
      .map((r) => ({
        id: Number(r.id),
        code: String(r.code),
        name: String(r.name),
        phone: String(r.phone),
        address: String(r.address || ''),
        contactPerson: String(r.contact_person || ''),
        note: String(r.note || ''),
        status: String(r.status),
        isDemo: Number(r.is_demo) === 1,
        orderCount: Number(r.orderCount || 0),
        totalReceivedKg: Number(r.totalReceivedKg || 0),
        totalPurchaseValue: Number(r.totalPurchaseValue || 0),
        createdAt: String(r.created_at),
      }));

    res.json({ items });
  }
);

partnersAndPurchasingRouter.get(
  '/suppliers/:id',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER),
  (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const sup = db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!sup) {
      res.status(404).json({ error: 'Không tìm thấy nhà cung cấp.' });
      return;
    }

    const orders = db
      .prepare(
        `SELECT po.id, po.code, po.request_date as requestDate, po.weighed_kg as weighedKg,
                po.received_kg as receivedKg, po.unit_price as unitPrice, po.status,
                po.is_demo as isDemo, u.full_name as assignedToName
         FROM purchasing_orders po
         JOIN users u ON u.id = po.assigned_to
         WHERE po.supplier_id = ?
         ORDER BY po.id DESC`
      )
      .all(id);

    const payables = db
      .prepare(
        `SELECT code, tx_date as txDate, total_amount as totalAmount,
                paid_amount as paidAmount, remaining_amount as remainingAmount, status
         FROM payables
         WHERE supplier_id = ?
         ORDER BY id DESC`
      )
      .all(id);

    res.json({
      supplier: {
        id: Number(sup.id),
        code: String(sup.code),
        name: String(sup.name),
        phone: String(sup.phone),
        address: String(sup.address || ''),
        contactPerson: String(sup.contact_person || ''),
        note: String(sup.note || ''),
        status: String(sup.status),
        isDemo: Number(sup.is_demo) === 1,
      },
      orders,
      payables,
      history: getEntityHistory(db, 'SUPPLIER', id),
    });
  }
);

partnersAndPurchasingRouter.post(
  '/suppliers',
  requireAuth,
  requireRoles(RoleCode.OWNER),
  (req: AuthedRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const address = String(req.body?.address || '').trim();
    const contactPerson = String(req.body?.contactPerson || '').trim();
    const note = String(req.body?.note || '').trim();

    if (!name || !phone) {
      res.status(400).json({ error: 'Vui lòng nhập tên nhà cung cấp và số điện thoại.' });
      return;
    }

    const created = withTransaction((db) => {
      const code = generateCode(db, 'suppliers', 'NCC');
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO suppliers (code, name, phone, address, contact_person, note, status, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)`
        )
        .run(code, name, phone, address, contactPerson, note, now, now);
      const id = Number(info.lastInsertRowid);
      writeAuditLog(db, {
        entityType: 'SUPPLIER',
        entityId: id,
        action: 'Tạo nhà cung cấp',
        toStatus: 'ACTIVE',
        referenceCode: code,
        actorId: req.user!.id,
        createdAt: now,
      });
      return { id, code };
    });

    res.status(201).json({ message: 'Đã thêm nhà cung cấp mới.', ...created });
  }
);

partnersAndPurchasingRouter.put(
  '/suppliers/:id',
  requireAuth,
  requireRoles(RoleCode.OWNER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const address = String(req.body?.address || '').trim();
    const contactPerson = String(req.body?.contactPerson || '').trim();
    const note = String(req.body?.note || '').trim();
    const status = String(req.body?.status || 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

    if (!name || !phone) {
      res.status(400).json({ error: 'Tên nhà cung cấp và số điện thoại là bắt buộc.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy nhà cung cấp.' });
      return;
    }

    withTransaction((txDb) => {
      const now = new Date().toISOString();
      txDb
        .prepare(
          `UPDATE suppliers SET name = ?, phone = ?, address = ?, contact_person = ?, note = ?, status = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(name, phone, address, contactPerson, note, status, now, id);
      writeAuditLog(txDb, {
        entityType: 'SUPPLIER',
        entityId: id,
        action: status === 'INACTIVE' ? 'Ngừng sử dụng nhà cung cấp' : 'Cập nhật thông tin nhà cung cấp',
        fromStatus: String(existing.status),
        toStatus: status,
        referenceCode: String(existing.code),
        actorId: req.user!.id,
        createdAt: now,
      });
    });

    res.json({ message: 'Đã cập nhật nhà cung cấp.' });
  }
);

// ==================== CUSTOMERS ====================
partnersAndPurchasingRouter.get(
  '/customers',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT c.*,
          COUNT(DISTINCT o.id) as outboundCount,
          COALESCE(SUM(CASE WHEN o.dispatched_kg > 0 THEN o.dispatched_kg ELSE 0 END), 0) as totalDispatchedKg,
          COALESCE((SELECT SUM(r.total_amount) FROM receivables r WHERE r.customer_id = c.id), 0) as totalSalesAmount,
          COALESCE((SELECT SUM(r.paid_amount) FROM receivables r WHERE r.customer_id = c.id), 0) as totalCollectedAmount,
          COALESCE((SELECT SUM(r.remaining_amount) FROM receivables r WHERE r.customer_id = c.id), 0) as totalRemainingAmount
         FROM customers c
         LEFT JOIN outbound_orders o ON o.customer_id = c.id
         GROUP BY c.id
         ORDER BY c.name ASC`
      )
      .all() as Array<Record<string, unknown>>;

    const includeFinancials = req.user!.role === RoleCode.OWNER;

    const items = rows
      .filter((r) => {
        if (status && String(r.status) !== status) return false;
        if (
          search &&
          !String(r.name).toLowerCase().includes(search) &&
          !String(r.code).toLowerCase().includes(search) &&
          !String(r.phone).toLowerCase().includes(search)
        ) {
          return false;
        }
        return true;
      })
      .map((r) => ({
        id: Number(r.id),
        code: String(r.code),
        name: String(r.name),
        phone: String(r.phone),
        address: String(r.address || ''),
        contactPerson: String(r.contact_person || ''),
        acceptedGrade: String(r.accepted_grade || 'Grade A & B'),
        note: String(r.note || ''),
        status: String(r.status),
        isDemo: Number(r.is_demo) === 1,
        outboundCount: Number(r.outboundCount || 0),
        totalDispatchedKg: Number(r.totalDispatchedKg || 0),
        totalSalesAmount: includeFinancials ? Number(r.totalSalesAmount || 0) : null,
        totalCollectedAmount: includeFinancials ? Number(r.totalCollectedAmount || 0) : null,
        totalRemainingAmount: includeFinancials ? Number(r.totalRemainingAmount || 0) : null,
      }));

    res.json({ items });
  }
);

partnersAndPurchasingRouter.get(
  '/customers/:id',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const cust = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!cust) {
      res.status(404).json({ error: 'Không tìm thấy khách hàng.' });
      return;
    }

    const orders = db
      .prepare(
        `SELECT id, code, requested_kg as requestedKg, dispatched_kg as dispatchedKg,
                accepted_grade as acceptedGrade, unit_price as unitPrice,
                total_value as totalValue, expected_date as expectedDate, status, is_demo as isDemo
         FROM outbound_orders
         WHERE customer_id = ?
         ORDER BY id DESC`
      )
      .all(id);

    const dispatches = db
      .prepare(
        `SELECT d.code, d.dispatched_kg as dispatchedKg, d.recipient_name as recipientName,
                d.vehicle_plate as vehiclePlate, d.dispatched_at as dispatchedAt,
                o.code as orderCode, fb.batch_code as batchCode
         FROM outbound_dispatches d
         JOIN outbound_orders o ON o.id = d.outbound_order_id
         JOIN finished_batches fb ON fb.id = d.batch_id
         WHERE o.customer_id = ?
         ORDER BY d.id DESC`
      )
      .all(id);

    const receivables =
      req.user!.role === RoleCode.OWNER
        ? db
            .prepare(
              `SELECT r.id, r.code, r.delivery_date as deliveryDate, r.total_amount as totalAmount,
                      r.paid_amount as paidAmount, r.remaining_amount as remainingAmount, r.status,
                      o.code as orderCode
               FROM receivables r
               JOIN outbound_orders o ON o.id = r.outbound_order_id
               WHERE r.customer_id = ?
               ORDER BY r.id DESC`
            )
            .all(id)
        : [];

    res.json({
      customer: {
        id: Number(cust.id),
        code: String(cust.code),
        name: String(cust.name),
        phone: String(cust.phone),
        address: String(cust.address || ''),
        contactPerson: String(cust.contact_person || ''),
        acceptedGrade: String(cust.accepted_grade),
        note: String(cust.note || ''),
        status: String(cust.status),
        isDemo: Number(cust.is_demo) === 1,
      },
      orders,
      dispatches,
      receivables,
      history: getEntityHistory(db, 'CUSTOMER', id),
    });
  }
);

partnersAndPurchasingRouter.post(
  '/customers',
  requireAuth,
  requireRoles(RoleCode.OWNER),
  (req: AuthedRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const address = String(req.body?.address || '').trim();
    const contactPerson = String(req.body?.contactPerson || '').trim();
    const acceptedGrade = String(req.body?.acceptedGrade || 'Grade A & B').trim();
    const note = String(req.body?.note || '').trim();

    if (!name || !phone) {
      res.status(400).json({ error: 'Vui lòng nhập tên khách hàng và số điện thoại.' });
      return;
    }
    if (!['Grade A', 'Grade B', 'Grade A & B'].includes(acceptedGrade)) {
      res.status(400).json({ error: 'Phân loại Grade khách hàng chấp nhận không hợp lệ.' });
      return;
    }

    const created = withTransaction((db) => {
      const code = generateCode(db, 'customers', 'KH');
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO customers (code, name, phone, address, contact_person, accepted_grade, note, status, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)`
        )
        .run(code, name, phone, address, contactPerson, acceptedGrade, note, now, now);
      const id = Number(info.lastInsertRowid);
      writeAuditLog(db, {
        entityType: 'CUSTOMER',
        entityId: id,
        action: 'Tạo khách hàng mới',
        toStatus: 'ACTIVE',
        referenceCode: code,
        actorId: req.user!.id,
        createdAt: now,
      });
      return { id, code };
    });

    res.status(201).json({ message: 'Đã thêm khách hàng mới.', ...created });
  }
);

partnersAndPurchasingRouter.put(
  '/customers/:id',
  requireAuth,
  requireRoles(RoleCode.OWNER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const address = String(req.body?.address || '').trim();
    const contactPerson = String(req.body?.contactPerson || '').trim();
    const acceptedGrade = String(req.body?.acceptedGrade || 'Grade A & B').trim();
    const note = String(req.body?.note || '').trim();
    const status = String(req.body?.status || 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

    if (!name || !phone) {
      res.status(400).json({ error: 'Tên khách hàng và số điện thoại là bắt buộc.' });
      return;
    }
    if (!['Grade A', 'Grade B', 'Grade A & B'].includes(acceptedGrade)) {
      res.status(400).json({ error: 'Phân loại Grade không hợp lệ.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy khách hàng.' });
      return;
    }

    withTransaction((txDb) => {
      const now = new Date().toISOString();
      txDb
        .prepare(
          `UPDATE customers SET name = ?, phone = ?, address = ?, contact_person = ?, accepted_grade = ?, note = ?, status = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(name, phone, address, contactPerson, acceptedGrade, note, status, now, id);
      writeAuditLog(txDb, {
        entityType: 'CUSTOMER',
        entityId: id,
        action: status === 'INACTIVE' ? 'Ngừng sử dụng khách hàng' : 'Cập nhật thông tin khách hàng',
        fromStatus: String(existing.status),
        toStatus: status,
        referenceCode: String(existing.code),
        actorId: req.user!.id,
        createdAt: now,
      });
    });

    res.json({ message: 'Đã cập nhật khách hàng.' });
  }
);

// ==================== PURCHASING ORDERS ====================
partnersAndPurchasingRouter.get(
  '/purchasing',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.PURCHASING_STAFF, RoleCode.WAREHOUSE_KEEPER),
  (req: AuthedRequest, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const db = getDb();

    let roleFilter = '';
    const params: Array<string | number> = [];

    if (req.user!.role === RoleCode.PURCHASING_STAFF) {
      roleFilter = 'WHERE po.assigned_to = ?';
      params.push(req.user!.id);
    } else if (req.user!.role === RoleCode.WAREHOUSE_KEEPER) {
      roleFilter = `WHERE po.status IN ('APPROVED', 'RECEIVED')`;
    }

    const rows = db
      .prepare(
        `SELECT po.*,
                s.name as supplierName, s.phone as supplierPhone, s.address as supplierAddress,
                u_assign.full_name as assignedToName,
                u_create.full_name as createdByName,
                u_app.full_name as approvedByName,
                u_rec.full_name as receivedByName,
                (SELECT file_url FROM attachments a WHERE a.entity_type = 'PURCHASING' AND a.entity_id = po.id ORDER BY a.id DESC LIMIT 1) as scaleImageUrl
         FROM purchasing_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         JOIN users u_assign ON u_assign.id = po.assigned_to
         JOIN users u_create ON u_create.id = po.created_by
         LEFT JOIN users u_app ON u_app.id = po.approved_by
         LEFT JOIN users u_rec ON u_rec.id = po.received_by
         ${roleFilter}
         ORDER BY po.id DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const items = rows
      .filter((r) => {
        if (status && String(r.status) !== status) return false;
        if (
          search &&
          !String(r.code).toLowerCase().includes(search) &&
          !String(r.supplierName).toLowerCase().includes(search) &&
          !String(r.assignedToName).toLowerCase().includes(search)
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
        supplierPhone: String(r.supplierPhone || ''),
        supplierAddress: String(r.supplierAddress || ''),
        materialName: 'NVL',
        assignedTo: Number(r.assigned_to),
        assignedToName: String(r.assignedToName),
        createdBy: Number(r.created_by),
        createdByName: String(r.createdByName),
        requestDate: String(r.request_date),
        requestNote: String(r.request_note || ''),
        weighedKg: r.weighed_kg !== null ? Number(r.weighed_kg) : null,
        unitPrice: r.unit_price !== null ? Number(r.unit_price) : null,
        totalAmount: r.total_amount !== null ? Number(r.total_amount) : null,
        purchasingNote: String(r.purchasing_note || ''),
        submittedAt: r.submitted_at ? String(r.submitted_at) : null,
        approvedByName: r.approvedByName ? String(r.approvedByName) : null,
        approvedAt: r.approved_at ? String(r.approved_at) : null,
        rejectReason: r.reject_reason ? String(r.reject_reason) : null,
        receivedKg: r.received_kg !== null ? Number(r.received_kg) : null,
        discrepancyKg: r.discrepancy_kg !== null ? Number(r.discrepancy_kg) : null,
        discrepancyNote: String(r.discrepancy_note || ''),
        receivedByName: r.receivedByName ? String(r.receivedByName) : null,
        receivedAt: r.received_at ? String(r.received_at) : null,
        scaleImageUrl: r.scaleImageUrl ? String(r.scaleImageUrl) : null,
        status: String(r.status),
        isDemo: Number(r.is_demo) === 1,
        createdAt: String(r.created_at),
      }));

    res.json({ items });
  }
);

partnersAndPurchasingRouter.get(
  '/purchasing/:id',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.PURCHASING_STAFF, RoleCode.WAREHOUSE_KEEPER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const r = db
      .prepare(
        `SELECT po.*,
                s.name as supplierName, s.phone as supplierPhone, s.address as supplierAddress,
                u_assign.full_name as assignedToName,
                u_create.full_name as createdByName,
                u_app.full_name as approvedByName,
                u_rec.full_name as receivedByName
         FROM purchasing_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         JOIN users u_assign ON u_assign.id = po.assigned_to
         JOIN users u_create ON u_create.id = po.created_by
         LEFT JOIN users u_app ON u_app.id = po.approved_by
         LEFT JOIN users u_rec ON u_rec.id = po.received_by
         WHERE po.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!r) {
      res.status(404).json({ error: 'Không tìm thấy phiếu thu mua.' });
      return;
    }

    if (req.user!.role === RoleCode.PURCHASING_STAFF && Number(r.assigned_to) !== req.user!.id) {
      res.status(403).json({ error: 'Bạn chỉ được xem yêu cầu thu mua được phân công cho mình.' });
      return;
    }
    if (
      req.user!.role === RoleCode.WAREHOUSE_KEEPER &&
      !['APPROVED', 'RECEIVED'].includes(String(r.status))
    ) {
      res.status(403).json({ error: 'Thủ kho chỉ tiếp nhận các phiếu thu mua đã được duyệt.' });
      return;
    }

    res.json({
      order: {
        id: Number(r.id),
        code: String(r.code),
        supplierId: Number(r.supplier_id),
        supplierName: String(r.supplierName),
        supplierPhone: String(r.supplierPhone || ''),
        supplierAddress: String(r.supplierAddress || ''),
        materialName: 'NVL',
        assignedTo: Number(r.assigned_to),
        assignedToName: String(r.assignedToName),
        createdBy: Number(r.created_by),
        createdByName: String(r.createdByName),
        requestDate: String(r.request_date),
        requestNote: String(r.request_note || ''),
        weighedKg: r.weighed_kg !== null ? Number(r.weighed_kg) : null,
        unitPrice: r.unit_price !== null ? Number(r.unit_price) : null,
        totalAmount: r.total_amount !== null ? Number(r.total_amount) : null,
        purchasingNote: String(r.purchasing_note || ''),
        submittedAt: r.submitted_at ? String(r.submitted_at) : null,
        approvedByName: r.approvedByName ? String(r.approvedByName) : null,
        approvedAt: r.approved_at ? String(r.approved_at) : null,
        rejectReason: r.reject_reason ? String(r.reject_reason) : null,
        receivedKg: r.received_kg !== null ? Number(r.received_kg) : null,
        discrepancyKg: r.discrepancy_kg !== null ? Number(r.discrepancy_kg) : null,
        discrepancyNote: String(r.discrepancy_note || ''),
        receivedByName: r.receivedByName ? String(r.receivedByName) : null,
        receivedAt: r.received_at ? String(r.received_at) : null,
        status: String(r.status),
        isDemo: Number(r.is_demo) === 1,
      },
      attachments: getEntityAttachments(db, 'PURCHASING', id),
      history: getEntityHistory(db, 'PURCHASING', id),
    });
  }
);

// Manager creates Purchasing Request & assigns Purchasing Staff
partnersAndPurchasingRouter.post(
  '/purchasing',
  requireAuth,
  requireRoles(RoleCode.MANAGER, RoleCode.OWNER),
  (req: AuthedRequest, res) => {
    const supplierId = Number(req.body?.supplierId);
    const assignedTo = Number(req.body?.assignedTo);
    const requestDate = String(req.body?.requestDate || '').trim();
    const requestNote = String(req.body?.requestNote || '').trim();

    if (!supplierId || !assignedTo || !requestDate) {
      res.status(400).json({
        error: 'Vui lòng chọn nhà cung cấp, nhân viên thu mua và ngày yêu cầu.',
      });
      return;
    }

    const db = getDb();
    const sup = db
      .prepare(`SELECT id, status FROM suppliers WHERE id = ?`)
      .get(supplierId) as Record<string, unknown> | undefined;
    if (!sup || String(sup.status) !== 'ACTIVE') {
      res.status(400).json({ error: 'Nhà cung cấp không hợp lệ hoặc đã ngừng sử dụng.' });
      return;
    }

    const assignee = db
      .prepare(`SELECT id, role, status FROM users WHERE id = ?`)
      .get(assignedTo) as Record<string, unknown> | undefined;
    if (
      !assignee ||
      String(assignee.status) !== 'ACTIVE' ||
      String(assignee.role) !== RoleCode.PURCHASING_STAFF
    ) {
      res.status(400).json({ error: 'Nhân sự được giao phải là Nhân viên thu mua đang hoạt động.' });
      return;
    }

    const created = withTransaction((txDb) => {
      const code = generateCode(txDb, 'purchasing_orders', 'TM', requestDate);
      const now = new Date().toISOString();
      const info = txDb
        .prepare(
          `INSERT INTO purchasing_orders (code, supplier_id, material_name, assigned_to, created_by, request_date, request_note, status, is_demo, created_at, updated_at)
           VALUES (?, ?, 'NVL', ?, ?, ?, ?, 'ASSIGNED', 0, ?, ?)`
        )
        .run(code, supplierId, assignedTo, req.user!.id, requestDate, requestNote, now, now);
      const id = Number(info.lastInsertRowid);

      writeAuditLog(txDb, {
        entityType: 'PURCHASING',
        entityId: id,
        action: 'Giao yêu cầu thu mua NVL',
        toStatus: 'ASSIGNED',
        referenceCode: code,
        actorId: req.user!.id,
        createdAt: now,
      });

      notifyUser(txDb, {
        userId: assignedTo,
        dedupKey: `po-assign-${id}-${now}`,
        title: 'Yêu cầu thu mua mới',
        message: `Bạn được phân công thực hiện yêu cầu thu mua ${code}.`,
        targetPath: '/thu-mua',
        referenceCode: code,
      });

      return { id, code };
    });

    res.status(201).json({ message: `Đã tạo yêu cầu thu mua ${created.code}.`, ...created });
  }
);

// Purchasing Staff updates result on assigned request (Save progress or Submit for approval)
partnersAndPurchasingRouter.put(
  '/purchasing/:id/result',
  requireAuth,
  requireRoles(RoleCode.PURCHASING_STAFF),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const weighedKg = Number(req.body?.weighedKg);
    const rawUnitPrice = req.body?.unitPrice;
    const unitPrice =
      rawUnitPrice !== undefined && rawUnitPrice !== null && String(rawUnitPrice).trim() !== ''
        ? Number(rawUnitPrice)
        : null;
    const purchasingNote = String(req.body?.purchasingNote || '').trim();
    const submitForApproval = Boolean(req.body?.submitForApproval);
    const scaleTicketAttachment = req.body?.scaleTicketAttachment as
      | { fileName: string; fileUrl: string; mimeType: string; fileSize: number; docType?: string }
      | undefined;

    if (!Number.isFinite(weighedKg) || weighedKg <= 0) {
      res.status(400).json({ error: 'Khối lượng thực tế cân phải là số lớn hơn 0.' });
      return;
    }
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      res.status(400).json({ error: 'Đơn giá không hợp lệ.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM purchasing_orders WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy yêu cầu thu mua.' });
      return;
    }
    if (Number(existing.assigned_to) !== req.user!.id) {
      res.status(403).json({ error: 'Bạn chỉ được cập nhật yêu cầu thu mua được giao cho mình.' });
      return;
    }
    if (!['ASSIGNED', 'IN_PROGRESS', 'REJECTED'].includes(String(existing.status))) {
      res.status(400).json({
        error: 'Phiếu đã gửi duyệt hoặc đã hoàn tất, không thể chỉnh sửa.',
      });
      return;
    }

    const existingScaleAttachments = db
      .prepare(`SELECT COUNT(*) as cnt FROM attachments WHERE entity_type = 'PURCHASING' AND entity_id = ?`)
      .get(id) as { cnt: number };

    if (
      submitForApproval &&
      !scaleTicketAttachment?.fileUrl &&
      Number(existingScaleAttachments.cnt) === 0
    ) {
      res.status(400).json({
        error: 'Vui lòng đính kèm ảnh phiếu cân trước khi gửi duyệt.',
      });
      return;
    }

    const nextStatus = submitForApproval ? 'PENDING_APPROVAL' : 'IN_PROGRESS';
    const totalAmount = unitPrice !== null ? Math.round(weighedKg * unitPrice) : null;

    withTransaction((txDb) => {
      const now = new Date().toISOString();

      if (scaleTicketAttachment?.fileUrl) {
        // Allow replacing draft scale ticket photo before submission
        txDb
          .prepare(
            `DELETE FROM attachments WHERE entity_type = 'PURCHASING' AND entity_id = ? AND doc_type = 'Ảnh phiếu cân'`
          )
          .run(id);
        txDb
          .prepare(
            `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
             VALUES ('PURCHASING', ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            scaleTicketAttachment.docType || 'Ảnh phiếu cân',
            scaleTicketAttachment.fileName,
            scaleTicketAttachment.fileUrl,
            scaleTicketAttachment.mimeType || 'image/jpeg',
            Number(scaleTicketAttachment.fileSize || 0),
            req.user!.id,
            now
          );
      }

      txDb
        .prepare(
          `UPDATE purchasing_orders
           SET weighed_kg = ?, unit_price = ?, total_amount = ?, purchasing_note = ?,
               submitted_at = CASE WHEN ? = 'PENDING_APPROVAL' THEN ? ELSE submitted_at END,
               status = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          weighedKg,
          unitPrice,
          totalAmount,
          purchasingNote,
          nextStatus,
          now,
          nextStatus,
          now,
          id
        );

      writeAuditLog(txDb, {
        entityType: 'PURCHASING',
        entityId: id,
        action: submitForApproval ? 'Gửi kết quả thu mua chờ duyệt' : 'Lưu tạm kết quả thu mua',
        fromStatus: String(existing.status),
        toStatus: nextStatus,
        referenceCode: String(existing.code),
        actorId: req.user!.id,
        createdAt: now,
      });

      if (submitForApproval) {
        notifyRoles(txDb, [RoleCode.MANAGER, RoleCode.OWNER], {
          dedupPrefix: `po-submit-${id}-${now}`,
          title: 'Phiếu thu mua chờ duyệt',
          message: `Phiếu ${existing.code} (${weighedKg.toLocaleString('vi-VN')} kg NVL) đang chờ duyệt.`,
          targetPath: '/thu-mua',
          referenceCode: String(existing.code),
        });
      }
    });

    res.json({
      message: submitForApproval
        ? 'Đã gửi phiếu thu mua chờ duyệt.'
        : 'Đã lưu thông tin thu mua.',
    });
  }
);

// Manager / Owner approves or rejects Purchasing Order (NO stock increase here!)
partnersAndPurchasingRouter.post(
  '/purchasing/:id/decision',
  requireAuth,
  requireRoles(RoleCode.MANAGER, RoleCode.OWNER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const decision = String(req.body?.decision || '').trim(); // 'APPROVE' | 'REJECT'
    const reason = String(req.body?.reason || '').trim();

    if (!['APPROVE', 'REJECT'].includes(decision)) {
      res.status(400).json({ error: 'Thao tác phê duyệt không hợp lệ.' });
      return;
    }
    if (decision === 'REJECT' && !reason) {
      res.status(400).json({ error: 'Vui lòng nhập lý do từ chối phiếu thu mua.' });
      return;
    }

    try {
      withTransaction((txDb) => {
        const po = txDb.prepare(`SELECT * FROM purchasing_orders WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!po) {
          throw new Error('NOT_FOUND');
        }
        if (Number(po.assigned_to) === req.user!.id) {
          throw new Error('SELF_APPROVAL');
        }
        if (String(po.status) !== 'PENDING_APPROVAL') {
          throw new Error('INVALID_STATE');
        }

        const now = new Date().toISOString();
        const nextStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

        txDb
          .prepare(
            `UPDATE purchasing_orders
             SET status = ?, approved_by = ?, approved_at = ?, reject_reason = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(nextStatus, req.user!.id, now, decision === 'REJECT' ? reason : null, now, id);

        writeAuditLog(txDb, {
          entityType: 'PURCHASING',
          entityId: id,
          action: decision === 'APPROVE' ? 'Duyệt phiếu thu mua' : 'Từ chối phiếu thu mua',
          fromStatus: 'PENDING_APPROVAL',
          toStatus: nextStatus,
          reason: decision === 'REJECT' ? reason : null,
          referenceCode: String(po.code),
          actorId: req.user!.id,
          createdAt: now,
        });

        if (decision === 'APPROVE') {
          notifyRoles(txDb, [RoleCode.WAREHOUSE_KEEPER], {
            dedupPrefix: `po-approved-${id}`,
            title: 'NVL chờ tiếp nhận kho',
            message: `Phiếu ${po.code} đã được duyệt, chờ Thủ kho xác nhận nhận hàng thực tế.`,
            targetPath: '/nhap-kho-nvl',
            referenceCode: String(po.code),
          });
        } else {
          notifyUser(txDb, {
            userId: Number(po.assigned_to),
            dedupKey: `po-rejected-${id}-${now}`,
            title: 'Phiếu thu mua bị từ chối',
            message: `Phiếu ${po.code} cần bổ sung/chỉnh sửa: ${reason}`,
            targetPath: '/thu-mua',
            referenceCode: String(po.code),
          });
        }
      });

      res.json({
        message:
          decision === 'APPROVE'
            ? 'Đã duyệt phiếu thu mua. Chuyển sang bước Thủ kho tiếp nhận thực tế.'
            : 'Đã từ chối phiếu thu mua và gửi lý do cho nhân viên thu mua.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NOT_FOUND') {
        res.status(404).json({ error: 'Không tìm thấy phiếu thu mua.' });
      } else if (msg === 'SELF_APPROVAL') {
        res.status(403).json({ error: 'Người thực hiện không được tự duyệt phiếu thu mua của mình.' });
      } else if (msg === 'INVALID_STATE') {
        res.status(400).json({ error: 'Phiếu thu mua không ở trạng thái chờ duyệt.' });
      } else {
        res.status(500).json({ error: 'Không thể xử lý phê duyệt phiếu thu mua.' });
      }
    }
  }
);

// Warehouse Keeper confirms actual Raw Material receipt -> ONLY step that increases NVL stock!
partnersAndPurchasingRouter.post(
  '/purchasing/:id/receive',
  requireAuth,
  requireRoles(RoleCode.WAREHOUSE_KEEPER),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const receivedKg = Number(req.body?.receivedKg);
    const discrepancyNote = String(req.body?.discrepancyNote || '').trim();

    if (!Number.isFinite(receivedKg) || receivedKg <= 0) {
      res.status(400).json({ error: 'Khối lượng thực nhận phải là số lớn hơn 0.' });
      return;
    }

    try {
      const outcome = withTransaction((txDb) => {
        const po = txDb.prepare(`SELECT * FROM purchasing_orders WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!po) throw new Error('NOT_FOUND');
        if (String(po.status) === 'RECEIVED') throw new Error('ALREADY_RECEIVED');
        if (String(po.status) !== 'APPROVED') throw new Error('NOT_APPROVED');

        const weighedKg = Number(po.weighed_kg || 0);
        const discrepancyKg = Math.round((receivedKg - weighedKg) * 100) / 100;
        if (discrepancyKg !== 0 && !discrepancyNote) {
          throw new Error('DISCREPANCY_NOTE_REQUIRED');
        }

        const now = new Date().toISOString();

        // Update PO preserving weighed_kg!
        txDb
          .prepare(
            `UPDATE purchasing_orders
             SET received_kg = ?, discrepancy_kg = ?, discrepancy_note = ?,
                 received_by = ?, received_at = ?, status = 'RECEIVED', updated_at = ?
             WHERE id = ? AND status = 'APPROVED'`
          )
          .run(receivedKg, discrepancyKg, discrepancyNote, req.user!.id, now, now, id);

        // Increase NVL Stock atomically
        const stockRow = txDb
          .prepare(`SELECT balance_kg FROM raw_material_stock WHERE material_code = 'NVL'`)
          .get() as { balance_kg: number };
        const newBalance = Math.round((Number(stockRow.balance_kg) + receivedKg) * 100) / 100;

        txDb
          .prepare(
            `UPDATE raw_material_stock SET balance_kg = ?, last_in_at = ?, updated_at = ? WHERE material_code = 'NVL'`
          )
          .run(newBalance, now, now);

        const txCode = `NK-NVL-${String(id).padStart(4, '0')}`;
        txDb
          .prepare(
            `INSERT INTO raw_material_ledger (tx_code, tx_type, quantity_kg, balance_after_kg, reference_type, reference_id, reference_code, note, actor_id, is_demo, created_at)
             VALUES (?, 'IN', ?, ?, 'PURCHASING', ?, ?, ?, ?, 0, ?)`
          )
          .run(
            txCode,
            receivedKg,
            newBalance,
            id,
            String(po.code),
            discrepancyKg !== 0
              ? `Thực nhận ${receivedKg} kg (chênh lệch ${discrepancyKg > 0 ? '+' : ''}${discrepancyKg} kg so với phiếu: ${discrepancyNote})`
              : `Nhập kho NVL thực nhận từ phiếu ${po.code}`,
            req.user!.id,
            now
          );

        // Create Payable if unit_price is recorded
        if (po.unit_price !== null && po.unit_price !== undefined) {
          const totalPayable = Math.round(receivedKg * Number(po.unit_price));
          const payCode = generateCode(txDb, 'payables', 'CN-PT', now.slice(0, 10));
          txDb
            .prepare(
              `INSERT OR IGNORE INTO payables (code, supplier_id, purchasing_order_id, tx_date, total_amount, paid_amount, remaining_amount, status, is_demo, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, ?, 'UNPAID', 0, ?, ?)`
            )
            .run(payCode, Number(po.supplier_id), id, now.slice(0, 10), totalPayable, totalPayable, now, now);
        }

        writeAuditLog(txDb, {
          entityType: 'PURCHASING',
          entityId: id,
          action: `Xác nhận nhận hàng thực tế (${receivedKg.toLocaleString('vi-VN')} kg)`,
          fromStatus: 'APPROVED',
          toStatus: 'RECEIVED',
          reason: discrepancyKg !== 0 ? `Chênh lệch ${discrepancyKg} kg: ${discrepancyNote}` : null,
          referenceCode: String(po.code),
          actorId: req.user!.id,
          createdAt: now,
        });

        if (discrepancyKg !== 0) {
          notifyRoles(txDb, [RoleCode.MANAGER, RoleCode.OWNER], {
            dedupPrefix: `po-disc-${id}`,
            title: 'Chênh lệch khối lượng nhập NVL',
            message: `Phiếu ${po.code}: trên phiếu ${weighedKg.toLocaleString('vi-VN')} kg, thực nhận ${receivedKg.toLocaleString('vi-VN')} kg (${discrepancyKg > 0 ? '+' : ''}${discrepancyKg} kg).`,
            targetPath: '/thu-mua',
            referenceCode: String(po.code),
          });
        }

        return { newBalance, discrepancyKg };
      });

      res.json({
        message: 'Đã xác nhận nhập kho NVL theo khối lượng thực nhận.',
        ...outcome,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NOT_FOUND') {
        res.status(404).json({ error: 'Không tìm thấy phiếu thu mua.' });
      } else if (msg === 'ALREADY_RECEIVED') {
        res.status(409).json({ error: 'Phiếu này đã được xác nhận nhập kho trước đó.' });
      } else if (msg === 'NOT_APPROVED') {
        res.status(400).json({ error: 'Chỉ được nhập kho khi phiếu thu mua đã được duyệt.' });
      } else if (msg === 'DISCREPANCY_NOTE_REQUIRED') {
        res.status(400).json({
          error: 'Khối lượng thực nhận khác khối lượng trên phiếu. Vui lòng nhập ghi chú chênh lệch.',
        });
      } else {
        res.status(500).json({ error: 'Không thể xác nhận nhập kho NVL.' });
      }
    }
  }
);

// ==================== RAW MATERIAL INVENTORY & PRODUCTION ISSUE ====================
partnersAndPurchasingRouter.get(
  '/inventory/raw',
  requireAuth,
  requireRoles(RoleCode.OWNER, RoleCode.MANAGER, RoleCode.WAREHOUSE_KEEPER),
  (_req, res) => {
    const db = getDb();
    const stock = db
      .prepare(`SELECT * FROM raw_material_stock WHERE material_code = 'NVL'`)
      .get() as Record<string, unknown>;

    const ledger = db
      .prepare(
        `SELECT l.id, l.tx_code as txCode, l.tx_type as txType, l.quantity_kg as quantityKg,
                l.balance_after_kg as balanceAfterKg, l.reference_type as referenceType,
                l.reference_code as referenceCode, l.shift, l.estimated_buckets as estimatedBuckets,
                l.note, l.is_demo as isDemo, l.created_at as createdAt,
                u_act.full_name as actorName,
                u_rec.full_name as receiverName
         FROM raw_material_ledger l
         JOIN users u_act ON u_act.id = l.actor_id
         LEFT JOIN users u_rec ON u_rec.id = l.receiver_id
         ORDER BY l.id DESC`
      )
      .all();

    res.json({
      stock: {
        materialCode: String(stock.material_code),
        materialName: String(stock.material_name),
        balanceKg: Number(stock.balance_kg),
        unit: String(stock.unit),
        lastInAt: stock.last_in_at ? String(stock.last_in_at) : null,
        updatedAt: String(stock.updated_at),
      },
      ledger,
    });
  }
);

partnersAndPurchasingRouter.post(
  '/warehouse/raw-issues',
  requireAuth,
  requireRoles(RoleCode.WAREHOUSE_KEEPER),
  (req: AuthedRequest, res) => {
    const planId = Number(req.body?.planId);
    const receiverId = Number(req.body?.receiverId);
    const quantityKg = Number(req.body?.quantityKg);
    const rawBuckets = req.body?.estimatedBuckets;
    const estimatedBuckets =
      rawBuckets !== undefined && rawBuckets !== null && String(rawBuckets).trim() !== ''
        ? Number(rawBuckets)
        : null;
    const note = String(req.body?.note || '').trim();

    if (!planId || !receiverId || !Number.isFinite(quantityKg) || quantityKg <= 0) {
      res.status(400).json({
        error: 'Vui lòng chọn kế hoạch sản xuất, người nhận và nhập khối lượng thực tế lớn hơn 0.',
      });
      return;
    }
    if (estimatedBuckets !== null && (!Number.isInteger(estimatedBuckets) || estimatedBuckets < 0)) {
      res.status(400).json({ error: 'Số gầu ước lượng tham khảo không hợp lệ.' });
      return;
    }

    try {
      const result = withTransaction((txDb) => {
        const plan = txDb.prepare(`SELECT * FROM production_plans WHERE id = ?`).get(planId) as
          | Record<string, unknown>
          | undefined;
        if (!plan || ['COMPLETED', 'CANCELLED'].includes(String(plan.status))) {
          throw new Error('INVALID_PLAN');
        }

        const stock = txDb
          .prepare(`SELECT balance_kg FROM raw_material_stock WHERE material_code = 'NVL'`)
          .get() as { balance_kg: number };
        const currentBalance = Number(stock.balance_kg);
        if (quantityKg > currentBalance) {
          throw new Error(`INSUFFICIENT_STOCK:${currentBalance}`);
        }

        const newBalance = Math.round((currentBalance - quantityKg) * 100) / 100;
        const now = new Date().toISOString();
        txDb
          .prepare(`UPDATE raw_material_stock SET balance_kg = ?, updated_at = ? WHERE material_code = 'NVL'`)
          .run(newBalance, now);

        const cntRow = txDb
          .prepare(`SELECT COUNT(*) as cnt FROM raw_material_ledger WHERE tx_type = 'OUT'`)
          .get() as { cnt: number };
        const txCode = `XK-NVL-${String(Number(cntRow.cnt) + 1).padStart(3, '0')}`;

        txDb
          .prepare(
            `INSERT INTO raw_material_ledger (
              tx_code, tx_type, quantity_kg, balance_after_kg, reference_type, reference_id, reference_code,
              plan_id, shift, receiver_id, estimated_buckets, note, actor_id, is_demo, created_at
            ) VALUES (?, 'OUT', ?, ?, 'PRODUCTION_ISSUE', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
          )
          .run(
            txCode,
            quantityKg,
            newBalance,
            planId,
            String(plan.code),
            planId,
            String(plan.shift),
            receiverId,
            estimatedBuckets,
            note || `Cấp NVL thực tế cho kế hoạch ${plan.code}`,
            req.user!.id,
            now
          );

        if (String(plan.status) === 'PLANNED') {
          txDb
            .prepare(`UPDATE production_plans SET status = 'RUNNING', updated_at = ? WHERE id = ?`)
            .run(now, planId);
        }

        notifyUser(txDb, {
          userId: receiverId,
          dedupKey: `nvl-issue-${txCode}`,
          title: 'Đã cấp NVL cho ca sản xuất',
          message: `Kho đã cấp ${quantityKg.toLocaleString('vi-VN')} kg NVL cho kế hoạch ${plan.code}.`,
          targetPath: '/bao-cao-ca',
          referenceCode: txCode,
        });

        return { txCode, newBalance };
      });

      res.status(201).json({
        message: `Đã cấp ${quantityKg.toLocaleString('vi-VN')} kg NVL (${result.txCode}).`,
        ...result,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'INVALID_PLAN') {
        res.status(400).json({ error: 'Kế hoạch sản xuất không hợp lệ hoặc đã kết thúc.' });
      } else if (msg.startsWith('INSUFFICIENT_STOCK:')) {
        const avail = Number(msg.split(':')[1] || 0);
        res.status(400).json({
          error: `Không đủ tồn kho NVL để cấp. Tồn khả dụng hiện tại: ${avail.toLocaleString('vi-VN')} kg.`,
        });
      } else {
        res.status(500).json({ error: 'Không thể ghi nhận phiếu cấp NVL.' });
      }
    }
  }
);
