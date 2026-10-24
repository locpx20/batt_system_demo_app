import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './security.ts';
import { RoleCode } from '../shared/types.ts';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export function getDataDir(): string {
  const dir = process.env.BATT_DATA_DIR
    ? path.resolve(process.env.BATT_DATA_DIR)
    : path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const uploadsDir = path.join(dir, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return dir;
}

export function getUploadsDir(): string {
  return path.join(getDataDir(), 'uploads');
}

export function getDb(): DatabaseSync {
  const targetPath = process.env.BATT_DB_PATH
    ? path.resolve(process.env.BATT_DB_PATH)
    : path.join(getDataDir(), 'batt_ppms.sqlite');

  if (!dbInstance || currentDbPath !== targetPath) {
    if (dbInstance) {
      try {
        dbInstance.close();
      } catch {
        // ignore close error
      }
    }
    const parent = path.dirname(targetPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    dbInstance = new DatabaseSync(targetPath);
    currentDbPath = targetPath;
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
    initSchema(dbInstance);
    ensureSeedData(dbInstance);
    migrateRemovePreOutboundQc(dbInstance);
  }
  return dbInstance;
}

export function withTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn(db);
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // ignore rollback error
    }
    throw err;
  }
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      contact_person TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      contact_person TEXT NOT NULL DEFAULT '',
      accepted_grade TEXT NOT NULL DEFAULT 'Grade A & B',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS purchasing_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      material_name TEXT NOT NULL DEFAULT 'NVL',
      assigned_to INTEGER NOT NULL REFERENCES users(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      request_date TEXT NOT NULL,
      request_note TEXT NOT NULL DEFAULT '',
      weighed_kg REAL,
      unit_price REAL,
      total_amount REAL,
      purchasing_note TEXT NOT NULL DEFAULT '',
      submitted_at TEXT,
      approved_by INTEGER REFERENCES users(id),
      approved_at TEXT,
      reject_reason TEXT,
      received_kg REAL,
      discrepancy_kg REAL,
      discrepancy_note TEXT NOT NULL DEFAULT '',
      received_by INTEGER REFERENCES users(id),
      received_at TEXT,
      status TEXT NOT NULL DEFAULT 'ASSIGNED',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_material_stock (
      material_code TEXT PRIMARY KEY,
      material_name TEXT NOT NULL,
      balance_kg REAL NOT NULL DEFAULT 0 CHECK (balance_kg >= 0),
      unit TEXT NOT NULL DEFAULT 'kg',
      last_in_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_material_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_code TEXT NOT NULL UNIQUE,
      tx_type TEXT NOT NULL,
      quantity_kg REAL NOT NULL CHECK (quantity_kg > 0),
      balance_after_kg REAL NOT NULL CHECK (balance_after_kg >= 0),
      reference_type TEXT NOT NULL,
      reference_id INTEGER,
      reference_code TEXT NOT NULL,
      plan_id INTEGER,
      shift TEXT,
      receiver_id INTEGER REFERENCES users(id),
      estimated_buckets INTEGER,
      note TEXT NOT NULL DEFAULT '',
      actor_id INTEGER NOT NULL REFERENCES users(id),
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      plan_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      target_kg REAL NOT NULL CHECK (target_kg > 0),
      machine_id INTEGER REFERENCES machines(id),
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PLANNED',
      created_by INTEGER NOT NULL REFERENCES users(id),
      completed_by INTEGER REFERENCES users(id),
      completed_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
      staff_id INTEGER NOT NULL REFERENCES users(id),
      task_role TEXT NOT NULL DEFAULT 'Vận hành dây chuyền',
      UNIQUE(plan_id, staff_id)
    );

    CREATE TABLE IF NOT EXISTS shift_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      batch_code TEXT NOT NULL UNIQUE,
      plan_id INTEGER NOT NULL REFERENCES production_plans(id),
      production_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      staff_id INTEGER NOT NULL REFERENCES users(id),
      nvl_used_kg REAL NOT NULL CHECK (nvl_used_kg > 0),
      output_kg REAL NOT NULL CHECK (output_kg > 0),
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'SUBMITTED',
      submitted_at TEXT NOT NULL,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      reject_reason TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finished_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_code TEXT NOT NULL UNIQUE,
      shift_report_id INTEGER NOT NULL UNIQUE REFERENCES shift_reports(id),
      plan_id INTEGER NOT NULL REFERENCES production_plans(id),
      production_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      producer_id INTEGER NOT NULL REFERENCES users(id),
      produced_kg REAL NOT NULL CHECK (produced_kg > 0),
      initial_kg REAL NOT NULL DEFAULT 0 CHECK (initial_kg >= 0),
      dispatched_kg REAL NOT NULL DEFAULT 0 CHECK (dispatched_kg >= 0),
      available_kg REAL NOT NULL DEFAULT 0 CHECK (available_kg >= 0),
      grade TEXT,
      qc_status TEXT NOT NULL DEFAULT 'PENDING_QC',
      warehouse_status TEXT NOT NULL DEFAULT 'PENDING_QC',
      packaging_info TEXT NOT NULL DEFAULT 'Bao Jumbo',
      received_by INTEGER REFERENCES users(id),
      received_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS qc_inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      inspection_type TEXT NOT NULL,
      batch_id INTEGER NOT NULL REFERENCES finished_batches(id),
      outbound_order_id INTEGER,
      grade TEXT NOT NULL,
      inspection_result TEXT NOT NULL DEFAULT 'PASSED',
      moisture_note TEXT NOT NULL DEFAULT '',
      durability_note TEXT NOT NULL DEFAULT '',
      appearance_note TEXT NOT NULL DEFAULT '',
      foreign_matter_note TEXT NOT NULL DEFAULT '',
      shift_grade_snapshot TEXT,
      has_discrepancy INTEGER NOT NULL DEFAULT 0,
      discrepancy_detail TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      inspector_id INTEGER NOT NULL REFERENCES users(id),
      inspected_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS finished_goods_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_code TEXT NOT NULL UNIQUE,
      batch_id INTEGER NOT NULL REFERENCES finished_batches(id),
      batch_code TEXT NOT NULL,
      tx_type TEXT NOT NULL,
      quantity_kg REAL NOT NULL CHECK (quantity_kg > 0),
      balance_after_kg REAL NOT NULL CHECK (balance_after_kg >= 0),
      reference_type TEXT NOT NULL,
      reference_id INTEGER,
      reference_code TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      actor_id INTEGER NOT NULL REFERENCES users(id),
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbound_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      product_name TEXT NOT NULL DEFAULT 'Viên gỗ nén',
      requested_kg REAL NOT NULL CHECK (requested_kg > 0),
      accepted_grade TEXT NOT NULL,
      unit_price REAL NOT NULL CHECK (unit_price >= 0),
      total_value REAL NOT NULL CHECK (total_value >= 0),
      expected_date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      manager_id INTEGER NOT NULL REFERENCES users(id),
      has_qc_discrepancy INTEGER NOT NULL DEFAULT 0,
      owner_id INTEGER REFERENCES users(id),
      owner_decision_at TEXT,
      owner_reason TEXT,
      recipient_name TEXT NOT NULL DEFAULT '',
      recipient_phone TEXT NOT NULL DEFAULT '',
      vehicle_plate TEXT NOT NULL DEFAULT '',
      delivery_note TEXT NOT NULL DEFAULT '',
      dispatched_kg REAL NOT NULL DEFAULT 0 CHECK (dispatched_kg >= 0),
      status TEXT NOT NULL DEFAULT 'PENDING_OWNER',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbound_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outbound_order_id INTEGER NOT NULL REFERENCES outbound_orders(id) ON DELETE CASCADE,
      batch_id INTEGER NOT NULL REFERENCES finished_batches(id),
      allocated_kg REAL NOT NULL CHECK (allocated_kg > 0),
      dispatched_kg REAL NOT NULL DEFAULT 0 CHECK (dispatched_kg >= 0),
      UNIQUE(outbound_order_id, batch_id)
    );

    CREATE TABLE IF NOT EXISTS outbound_dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      outbound_order_id INTEGER NOT NULL REFERENCES outbound_orders(id),
      batch_id INTEGER NOT NULL REFERENCES finished_batches(id),
      dispatched_kg REAL NOT NULL CHECK (dispatched_kg > 0),
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      vehicle_plate TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      warehouse_keeper_id INTEGER NOT NULL REFERENCES users(id),
      dispatched_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS maintenance_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      machine_id INTEGER NOT NULL REFERENCES machines(id),
      plan_id INTEGER REFERENCES production_plans(id),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      issue_type TEXT NOT NULL DEFAULT 'Cơ khí',
      severity TEXT NOT NULL DEFAULT 'Cần xử lý trong ca',
      description TEXT NOT NULL,
      assigned_by INTEGER REFERENCES users(id),
      assigned_to INTEGER REFERENCES users(id),
      assigned_at TEXT,
      assignment_note TEXT NOT NULL DEFAULT '',
      repair_result TEXT NOT NULL DEFAULT '',
      materials_used TEXT NOT NULL DEFAULT '',
      completed_work_at TEXT,
      repair_note TEXT NOT NULL DEFAULT '',
      confirmed_by INTEGER REFERENCES users(id),
      confirmed_at TEXT,
      reject_reason TEXT,
      status TEXT NOT NULL DEFAULT 'NEW_ISSUE',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spare_part_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      maintenance_request_id INTEGER REFERENCES maintenance_requests(id),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      note TEXT NOT NULL DEFAULT '',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spare_part_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_part_request_id INTEGER NOT NULL REFERENCES spare_part_requests(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL DEFAULT 'cái',
      spec_note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      decision_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS payables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      purchasing_order_id INTEGER NOT NULL UNIQUE REFERENCES purchasing_orders(id),
      tx_date TEXT NOT NULL,
      total_amount REAL NOT NULL CHECK (total_amount >= 0),
      paid_amount REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
      remaining_amount REAL NOT NULL CHECK (remaining_amount >= 0),
      status TEXT NOT NULL DEFAULT 'UNPAID',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payable_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payable_id INTEGER NOT NULL REFERENCES payables(id),
      amount REAL NOT NULL CHECK (amount > 0),
      payment_date TEXT NOT NULL,
      method_note TEXT NOT NULL DEFAULT '',
      recorded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receivables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      outbound_order_id INTEGER NOT NULL UNIQUE REFERENCES outbound_orders(id),
      delivery_date TEXT NOT NULL,
      total_amount REAL NOT NULL CHECK (total_amount >= 0),
      paid_amount REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
      remaining_amount REAL NOT NULL CHECK (remaining_amount >= 0),
      status TEXT NOT NULL DEFAULT 'UNPAID',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receivable_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receivable_id INTEGER NOT NULL REFERENCES receivables(id),
      amount REAL NOT NULL CHECK (amount > 0),
      payment_date TEXT NOT NULL,
      method_note TEXT NOT NULL DEFAULT '',
      recorded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      reason TEXT,
      reference_code TEXT,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      dedup_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target_path TEXT NOT NULL,
      reference_code TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

function writeDemoSvgAsset(filename: string, title: string, lines: string[]): string {
  const uploadsDir = getUploadsDir();
  const fullPath = path.join(uploadsDir, filename);
  if (!fs.existsSync(fullPath)) {
    const lineElements = lines
      .map(
        (txt, idx) =>
          `<text x="36" y="${128 + idx * 32}" font-family="sans-serif" font-size="16" fill="#1e293b">${txt}</text>`
      )
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
      <rect width="640" height="400" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
      <rect x="20" y="20" width="600" height="58" rx="6" fill="#0f172a"/>
      <text x="36" y="55" font-family="sans-serif" font-size="18" font-weight="bold" fill="#ffffff">${title}</text>
      <text x="480" y="54" font-family="monospace" font-size="13" fill="#94a3b8">[MẪU DEMO]</text>
      ${lineElements}
      <line x1="36" y1="330" x2="604" y2="330" stroke="#e2e8f0" stroke-width="1"/>
      <text x="36" y="362" font-family="sans-serif" font-size="13" fill="#64748b">CÔNG TY CỔ PHẦN NĂNG LƯỢNG TÁI TẠO BATT — Chứng từ minh họa môi trường thử nghiệm</text>
    </svg>`;
    fs.writeFileSync(fullPath, svg, 'utf8');
  }
  return `/uploads/${filename}`;
}

function ensureSeedData(db: DatabaseSync): void {
  const existingUsers = db.prepare(`SELECT COUNT(*) as cnt FROM users`).get() as { cnt: number };
  if (Number(existingUsers.cnt) > 0) {
    return;
  }

  const now = '2026-10-24T06:00:00.000Z';
  const defaultPwd = hashPassword('Batt@2026');

  // Ensure canonical NVL inventory row exists
  db.prepare(
    `INSERT INTO raw_material_stock (material_code, material_name, balance_kg, unit, last_in_at, updated_at)
     VALUES ('NVL', 'NVL', 0, 'kg', NULL, ?)`
  ).run(now);

  // Create test accounts for all 8 internal actors (plus additional staff for multi-user tests)
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, full_name, role, phone, email, status, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );

  const ownerId = Number(
    insertUser.run(
      'owner',
      defaultPwd,
      'Nguyễn Quốc Bảo',
      RoleCode.OWNER,
      '0903112233',
      'locxuanpham2000@gmail.com',
      'ACTIVE',
      now,
      now
    ).lastInsertRowid
  );
  const managerId = Number(
    insertUser.run(
      'manager',
      defaultPwd,
      'Trần Minh Quân',
      RoleCode.MANAGER,
      '0903223344',
      'quan.tran@batt.vn',
      'ACTIVE',
      now,
      now
    ).lastInsertRowid
  );
  const purchasing1Id = Number(
    insertUser.run(
      'purchasing1',
      defaultPwd,
      'Lê Hoàng Nam',
      RoleCode.PURCHASING_STAFF,
      '0903334455',
      'nam.le@batt.vn',
      'ACTIVE',
      now,
      now
    ).lastInsertRowid
  );
  const warehouse1Id = Number(
    insertUser.run(
      'warehouse1',
      defaultPwd,
      'Phạm Văn Hùng',
      RoleCode.WAREHOUSE_KEEPER,
      '0903445566',
      'hung.pham@batt.vn',
      'ACTIVE',
      now,
      now
    ).lastInsertRowid
  );
  const staff1Id = Number(
    insertUser.run(
      'staff1',
      defaultPwd,
      'Đặng Quốc Tuấn',
      RoleCode.STAFF,
      '0903556677',
      'tuan.dang@batt.vn',
      'ACTIVE',
      now,
      now
    ).lastInsertRowid
  );
  const staff2Id = Number(
    insertUser.run(
      'staff2',
      defaultPwd,
      'Võ Thành Đạt',
      RoleCode.STAFF,
      '0903556688',
      'dat.vo@batt.vn',
      'ACTIVE',
      now,
      now
    ).lastInsertRowid
  );
  const qc1Id = Number(
    insertUser.run(
      'qc1',
      defaultPwd,
      'Hoàng Thu Trang',
      RoleCode.QC_STAFF,
      '0903667788',
      'trang.hoang@batt.vn',
      'ACTIVE',
      now,
      now
    ).lastInsertRowid
  );
  const maint1Id = Number(
    insertUser.run(
      'maint1',
      defaultPwd,
      'Bùi Đức Thắng',
      RoleCode.MAINTENANCE_STAFF,
      '0903778899',
      'thang.bui@batt.vn',
      'ACTIVE',
      now,
      now
    ).lastInsertRowid
  );
  insertUser.run(
    'admin',
    defaultPwd,
    'Vũ Hải Đăng',
    RoleCode.ADMIN_SYSTEM,
    '0903889900',
    'admin@batt.vn',
    'ACTIVE',
    now,
    now
  );
  insertUser.run(
    'inactive_user',
    defaultPwd,
    'Ngô Văn Cũ',
    RoleCode.STAFF,
    '0903000111',
    'inactive@batt.vn',
    'INACTIVE',
    now,
    now
  );

  // Seed Machines
  const insertMachine = db.prepare(
    `INSERT INTO machines (code, name, area, status, is_demo) VALUES (?, ?, ?, 'ACTIVE', 1)`
  );
  const machine1Id = Number(
    insertMachine.run('MC-EP-01', 'Dây chuyền ép viên số 1', 'Khu ép viên & đóng bao').lastInsertRowid
  );
  const machine2Id = Number(
    insertMachine.run('MC-SAY-01', 'Hệ thống sấy thùng quay số 1', 'Khu băm nghiền sấy').lastInsertRowid
  );
  insertMachine.run('MC-BAM-01', 'Máy băm công suất lớn 01', 'Bãi tiếp nhận NVL');

  // Seed Suppliers (marked is_demo = 1)
  const insertSupplier = db.prepare(
    `INSERT INTO suppliers (code, name, phone, address, contact_person, note, status, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`
  );
  const sup1Id = Number(
    insertSupplier.run(
      'NCC-001',
      'Xưởng chế biến lâm sản Hòa Phát Bình Dương',
      '0918223311',
      'KCN Nam Tân Uyên, Bình Dương',
      'Ông Nguyễn Hòa',
      'Đối tác cung cấp NVL định kỳ [Mẫu thử nghiệm]',
      '2026-10-18T08:00:00.000Z',
      '2026-10-18T08:00:00.000Z'
    ).lastInsertRowid
  );
  const sup2Id = Number(
    insertSupplier.run(
      'NCC-002',
      'Cơ sở thu gom gỗ rừng trồng Đồng Phú',
      '0919445522',
      'Huyện Đồng Phú, Bình Phước',
      'Bà Lê Thị Mai',
      'Nguồn NVL khu vực Bình Phước [Mẫu thử nghiệm]',
      '2026-10-19T08:00:00.000Z',
      '2026-10-19T08:00:00.000Z'
    ).lastInsertRowid
  );

  // Seed Customers (marked is_demo = 1)
  const insertCustomer = db.prepare(
    `INSERT INTO customers (code, name, phone, address, contact_person, accepted_grade, note, status, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`
  );
  const cust1Id = Number(
    insertCustomer.run(
      'KH-001',
      'Công ty TNHH Nhiệt điện Sinh khối Đông Nam',
      '02838991122',
      'KCN Phú Mỹ 1, Bà Rịa - Vũng Tàu',
      'Ông Phan Thanh Tùng',
      'Grade A',
      'Yêu cầu lô Grade A theo hợp đồng [Mẫu thử nghiệm]',
      '2026-10-18T08:00:00.000Z',
      '2026-10-18T08:00:00.000Z'
    ).lastInsertRowid
  );
  const cust2Id = Number(
    insertCustomer.run(
      'KH-002',
      'Công ty Cổ phần Dệt nhuộm Minh Hưng',
      '02743667788',
      'KCN Minh Hưng III, Bình Phước',
      'Bà Trần Ngọc Lan',
      'Grade B',
      'Sử dụng lò hơi công nghiệp chấp nhận Grade B [Mẫu thử nghiệm]',
      '2026-10-19T08:00:00.000Z',
      '2026-10-19T08:00:00.000Z'
    ).lastInsertRowid
  );

  // Demo SVG attachments
  const scaleTicket1Url = writeDemoSvgAsset('demo_scale_tm_001.svg', 'PHIẾU CÂN XE NHẬP NVL — TM-261020-01', [
    'Đơn vị cung cấp: Xưởng chế biến lâm sản Hòa Phát Bình Dương',
    'Mặt hàng: NVL sản xuất viên gỗ nén',
    'Khối lượng hàng cân: 32.500 kg | Thực nhận tại kho: 32.400 kg',
    'Ngày cân: 20/10/2026 09:45 — Người giao: Lê Hoàng Nam',
  ]);
  const scaleTicket2Url = writeDemoSvgAsset('demo_scale_tm_002.svg', 'PHIẾU CÂN XE NHẬP NVL — TM-261023-01', [
    'Đơn vị cung cấp: Cơ sở thu gom gỗ rừng trồng Đồng Phú',
    'Mặt hàng: NVL sản xuất viên gỗ nén',
    'Khối lượng cân tại trạm: 18.500 kg',
    'Ngày cân: 23/10/2026 15:20 — Chờ Quản lý xưởng duyệt',
  ]);
  const qcPhoto1Url = writeDemoSvgAsset('demo_qc_tp_001.svg', 'ẢNH BẰNG CHỨNG QC THEO CA — TP/26/10/21-C1-01', [
    'Lô thành phẩm: TP/26/10/21-C1-01 | Phân loại: Grade A',
    'Bề mặt viên nén bóng chắc, đồng đều đường kính 8mm',
    'Người kiểm tra: Hoàng Thu Trang — Ngày 21/10/2026 14:30',
  ]);
  const qcPhoto2Url = writeDemoSvgAsset('demo_qc_tp_002.svg', 'ẢNH BẰNG CHỨNG QC THEO CA — TP/26/10/22-C1-01', [
    'Lô thành phẩm: TP/26/10/22-C1-01 | Phân loại: Grade B',
    'Viên nén chắc, màu sẫm nhẹ theo nguồn vỏ gỗ, đủ điều kiện thương mại',
    'Người kiểm tra: Hoàng Thu Trang — Ngày 22/10/2026 15:00',
  ]);
  const machinePhotoUrl = writeDemoSvgAsset('demo_maint_bt_001.svg', 'ẢNH HIỆN TRƯỜNG SỰ CỐ MÁY — BT-261024-01', [
    'Thiết bị: Hệ thống sấy thùng quay số 1 (MC-SAY-01)',
    'Hiện tượng: Bạc đạn gối đỡ phát tiếng kêu lớn cuối ca',
    'Người báo: Đặng Quốc Tuấn — Ngày 24/10/2026 05:40',
  ]);

  // 1) Completed Purchasing Order + Received into NVL Stock (32,400 kg received vs 32,500 kg ticket)
  const po1Id = Number(
    db
      .prepare(
        `INSERT INTO purchasing_orders (
          code, supplier_id, material_name, assigned_to, created_by, request_date, request_note,
          weighed_kg, unit_price, total_amount, purchasing_note, submitted_at,
          approved_by, approved_at, received_kg, discrepancy_kg, discrepancy_note, received_by, received_at,
          status, is_demo, created_at, updated_at
        ) VALUES (?, ?, 'NVL', ?, ?, '2026-10-20', ?, 32500, 1450, 47125000, ?, '2026-10-20T10:00:00.000Z',
          ?, '2026-10-20T10:30:00.000Z', 32400, -100, ?, ?, '2026-10-20T11:15:00.000Z',
          'RECEIVED', 1, '2026-10-20T08:00:00.000Z', '2026-10-20T11:15:00.000Z')`
      )
      .run(
        'TM-261020-01',
        sup1Id,
        purchasing1Id,
        managerId,
        'Thu mua NVL đợt 1 tuần 4 [Mẫu thử nghiệm]',
        'Đã cân tại trạm cân Hòa Phát',
        managerId,
        'Độ ẩm bề mặt bay hơi nhẹ trên đường vận chuyển (-100 kg)',
        warehouse1Id
      ).lastInsertRowid
  );

  db.prepare(
    `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
     VALUES ('PURCHASING', ?, 'Ảnh phiếu cân', 'phieu-can-tm-261020-01.svg', ?, 'image/svg+xml', 1420, ?, '2026-10-20T10:00:00.000Z')`
  ).run(po1Id, scaleTicket1Url, purchasing1Id);

  // Payable from PO1 (actual received 32,400 * 1,450 = 46,980,000 VND; partial paid 20,000,000 VND)
  const payable1Id = Number(
    db
      .prepare(
        `INSERT INTO payables (code, supplier_id, purchasing_order_id, tx_date, total_amount, paid_amount, remaining_amount, status, is_demo, created_at, updated_at)
         VALUES ('CN-PT-001', ?, ?, '2026-10-20', 46980000, 20000000, 26980000, 'PARTIAL_PAID', 1, '2026-10-20T11:15:00.000Z', '2026-10-21T09:00:00.000Z')`
      )
      .run(sup1Id, po1Id).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO payable_payments (payable_id, amount, payment_date, method_note, recorded_by, created_at)
     VALUES (?, 20000000, '2026-10-21', 'Ủy nhiệm chi đợt 1 [Mẫu thử nghiệm]', ?, '2026-10-21T09:00:00.000Z')`
  ).run(payable1Id, ownerId);

  // 2) Purchasing Order #2: Pending Manager Approval (PENDING_APPROVAL)
  const po2Id = Number(
    db
      .prepare(
        `INSERT INTO purchasing_orders (
          code, supplier_id, material_name, assigned_to, created_by, request_date, request_note,
          weighed_kg, unit_price, total_amount, purchasing_note, submitted_at,
          status, is_demo, created_at, updated_at
        ) VALUES (?, ?, 'NVL', ?, ?, '2026-10-23', ?, 18500, 1420, 26270000, ?, '2026-10-23T15:30:00.000Z',
          'PENDING_APPROVAL', 1, '2026-10-23T08:00:00.000Z', '2026-10-23T15:30:00.000Z')`
      )
      .run(
        'TM-261023-01',
        sup2Id,
        purchasing1Id,
        managerId,
        'Bổ sung NVL cho kế hoạch cuối tuần [Mẫu thử nghiệm]',
        'Đã cân 18.500 kg, chờ duyệt nhập kho'
      ).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
     VALUES ('PURCHASING', ?, 'Ảnh phiếu cân', 'phieu-can-tm-261023-01.svg', ?, 'image/svg+xml', 1410, ?, '2026-10-23T15:30:00.000Z')`
  ).run(po2Id, scaleTicket2Url, purchasing1Id);

  // 3) Purchasing Order #3: Approved by Manager, waiting for Warehouse Keeper receipt (APPROVED)
  const po3Id = Number(
    db
      .prepare(
        `INSERT INTO purchasing_orders (
          code, supplier_id, material_name, assigned_to, created_by, request_date, request_note,
          weighed_kg, unit_price, total_amount, purchasing_note, submitted_at,
          approved_by, approved_at,
          status, is_demo, created_at, updated_at
        ) VALUES (?, ?, 'NVL', ?, ?, '2026-10-23', ?, 14000, 1450, 20300000, ?, '2026-10-23T16:10:00.000Z',
          ?, '2026-10-23T17:00:00.000Z',
          'APPROVED', 1, '2026-10-23T09:00:00.000Z', '2026-10-23T17:00:00.000Z')`
      )
      .run(
        'TM-261023-02',
        sup1Id,
        purchasing1Id,
        managerId,
        'Thu mua NVL bổ sung ca sáng [Mẫu thử nghiệm]',
        'Xe đã về cổng nhà máy chờ Thủ kho cân nhận',
        managerId
      ).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
     VALUES ('PURCHASING', ?, 'Ảnh phiếu cân', 'phieu-can-tm-261023-02.svg', ?, 'image/svg+xml', 1410, ?, '2026-10-23T16:10:00.000Z')`
  ).run(po3Id, scaleTicket1Url, purchasing1Id);

  // 4) Purchasing Order #4: Assigned to purchasing1 to update result
  db.prepare(
    `INSERT INTO purchasing_orders (
      code, supplier_id, material_name, assigned_to, created_by, request_date, request_note,
      status, is_demo, created_at, updated_at
    ) VALUES ('TM-261024-01', ?, 'NVL', ?, ?, '2026-10-24', 'Thu mua NVL theo lịch ngày 24/10 [Mẫu thử nghiệm]',
      'ASSIGNED', 1, '2026-10-24T05:30:00.000Z', '2026-10-24T05:30:00.000Z')`
  ).run(sup2Id, purchasing1Id, managerId);

  // Production Plans & NVL Ledger
  // Initial IN from PO1: +32,400 kg -> Issue 12,000 kg to Plan 1 -> Issue 10,000 kg to Plan 2 -> Remaining NVL = 10,400 kg
  const plan1Id = Number(
    db
      .prepare(
        `INSERT INTO production_plans (code, plan_date, shift, target_kg, machine_id, note, status, created_by, completed_by, completed_at, is_demo, created_at, updated_at)
         VALUES ('KH-261021-01', '2026-10-21', 'Ca 1', 9500, ?, 'Kế hoạch ép viên ngày 21/10 [Mẫu thử nghiệm]', 'COMPLETED', ?, ?, '2026-10-21T15:00:00.000Z', 1, '2026-10-21T06:00:00.000Z', '2026-10-21T15:00:00.000Z')`
      )
      .run(machine1Id, managerId, managerId).lastInsertRowid
  );
  const plan2Id = Number(
    db
      .prepare(
        `INSERT INTO production_plans (code, plan_date, shift, target_kg, machine_id, note, status, created_by, completed_by, completed_at, is_demo, created_at, updated_at)
         VALUES ('KH-261022-01', '2026-10-22', 'Ca 1', 8000, ?, 'Kế hoạch ép viên ngày 22/10 [Mẫu thử nghiệm]', 'COMPLETED', ?, ?, '2026-10-22T15:30:00.000Z', 1, '2026-10-22T06:00:00.000Z', '2026-10-22T15:30:00.000Z')`
      )
      .run(machine1Id, managerId, managerId).lastInsertRowid
  );
  const plan3Id = Number(
    db
      .prepare(
        `INSERT INTO production_plans (code, plan_date, shift, target_kg, machine_id, note, status, created_by, is_demo, created_at, updated_at)
         VALUES ('KH-261024-01', '2026-10-24', 'Ca 1', 9000, ?, 'Kế hoạch sản xuất hôm nay [Mẫu thử nghiệm]', 'RUNNING', ?, 1, '2026-10-24T05:30:00.000Z', '2026-10-24T05:30:00.000Z')`
      )
      .run(machine1Id, managerId).lastInsertRowid
  );

  db.prepare(`INSERT INTO plan_assignments (plan_id, staff_id, task_role) VALUES (?, ?, 'Vận hành ép viên & Đóng bao')`).run(plan1Id, staff1Id);
  db.prepare(`INSERT INTO plan_assignments (plan_id, staff_id, task_role) VALUES (?, ?, 'Vận hành ép viên & Đóng bao')`).run(plan2Id, staff1Id);
  db.prepare(`INSERT INTO plan_assignments (plan_id, staff_id, task_role) VALUES (?, ?, 'Vận hành ép viên chính')`).run(plan3Id, staff1Id);
  db.prepare(`INSERT INTO plan_assignments (plan_id, staff_id, task_role) VALUES (?, ?, 'Phụ trách cấp liệu & Sấy')`).run(plan3Id, staff2Id);

  // Record NVL Ledger: +32400, -12000, -10000 => 10400 kg balance
  db.prepare(
    `INSERT INTO raw_material_ledger (tx_code, tx_type, quantity_kg, balance_after_kg, reference_type, reference_id, reference_code, note, actor_id, is_demo, created_at)
     VALUES ('NK-NVL-001', 'IN', 32400, 32400, 'PURCHASING', ?, 'TM-261020-01', 'Nhập kho thực nhận từ phiếu TM-261020-01', ?, 1, '2026-10-20T11:15:00.000Z')`
  ).run(po1Id, warehouse1Id);
  db.prepare(
    `INSERT INTO raw_material_ledger (tx_code, tx_type, quantity_kg, balance_after_kg, reference_type, reference_id, reference_code, plan_id, shift, receiver_id, estimated_buckets, note, actor_id, is_demo, created_at)
     VALUES ('XK-NVL-001', 'OUT', 12000, 20400, 'PRODUCTION_ISSUE', ?, 'KH-261021-01', ?, 'Ca 1', ?, 120, 'Cấp NVL theo cân thực tế cho Ca 1 ngày 21/10', ?, 1, '2026-10-21T07:00:00.000Z')`
  ).run(plan1Id, plan1Id, staff1Id, warehouse1Id);
  db.prepare(
    `INSERT INTO raw_material_ledger (tx_code, tx_type, quantity_kg, balance_after_kg, reference_type, reference_id, reference_code, plan_id, shift, receiver_id, estimated_buckets, note, actor_id, is_demo, created_at)
     VALUES ('XK-NVL-002', 'OUT', 10000, 10400, 'PRODUCTION_ISSUE', ?, 'KH-261022-01', ?, 'Ca 1', ?, 100, 'Cấp NVL theo cân thực tế cho Ca 1 ngày 22/10', ?, 1, '2026-10-22T07:00:00.000Z')`
  ).run(plan2Id, plan2Id, staff1Id, warehouse1Id);

  db.prepare(
    `UPDATE raw_material_stock SET balance_kg = 10400, last_in_at = '2026-10-20T11:15:00.000Z', updated_at = '2026-10-22T07:00:00.000Z' WHERE material_code = 'NVL'`
  ).run();

  // Shift Reports & Finished Batches
  const sr1Id = Number(
    db
      .prepare(
        `INSERT INTO shift_reports (code, batch_code, plan_id, production_date, shift, staff_id, nvl_used_kg, output_kg, note, status, submitted_at, reviewed_by, reviewed_at, is_demo, created_at, updated_at)
         VALUES ('BC-261021-01', 'TP/26/10/21-C1-01', ?, '2026-10-21', 'Ca 1', ?, 11800, 9600, 'Đóng 12 bao Jumbo x 800 kg [Mẫu thử nghiệm]', 'APPROVED', '2026-10-21T14:00:00.000Z', ?, '2026-10-21T14:15:00.000Z', 1, '2026-10-21T14:00:00.000Z', '2026-10-21T14:15:00.000Z')`
      )
      .run(plan1Id, staff1Id, managerId).lastInsertRowid
  );
  const batch1Id = Number(
    db
      .prepare(
        `INSERT INTO finished_batches (batch_code, shift_report_id, plan_id, production_date, shift, producer_id, produced_kg, initial_kg, dispatched_kg, available_kg, grade, qc_status, warehouse_status, packaging_info, received_by, received_at, is_demo, created_at, updated_at)
         VALUES ('TP/26/10/21-C1-01', ?, ?, '2026-10-21', 'Ca 1', ?, 9600, 9600, 0, 9600, 'Grade A', 'INSPECTED', 'IN_STOCK', '12 bao Jumbo (800 kg/bao)', ?, '2026-10-21T15:00:00.000Z', 1, '2026-10-21T14:15:00.000Z', '2026-10-21T15:00:00.000Z')`
      )
      .run(sr1Id, plan1Id, staff1Id, warehouse1Id).lastInsertRowid
  );
  const qc1InspId = Number(
    db
      .prepare(
        `INSERT INTO qc_inspections (code, inspection_type, batch_id, grade, inspection_result, moisture_note, durability_note, appearance_note, foreign_matter_note, note, inspector_id, inspected_at, is_demo)
         VALUES ('QC-CA-001', 'SHIFT_QC', ?, 'Grade A', 'PASSED', 'Độ ẩm ổn định theo mẫu đo ca', 'Độ bền cơ học cao, ít bụi mịn', 'Viên sáng màu, bề mặt bóng láng', 'Không phát hiện tạp chất', 'Đạt phân loại Grade A [Mẫu thử nghiệm]', ?, '2026-10-21T14:35:00.000Z', 1)`
      )
      .run(batch1Id, qc1Id).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
     VALUES ('QC', ?, 'Ảnh kiểm tra QC theo ca', 'qc-tp-261021-c1-01.svg', ?, 'image/svg+xml', 1380, ?, '2026-10-21T14:35:00.000Z')`
  ).run(qc1InspId, qcPhoto1Url, qc1Id);
  db.prepare(
    `INSERT INTO finished_goods_ledger (tx_code, batch_id, batch_code, tx_type, quantity_kg, balance_after_kg, reference_type, reference_id, reference_code, note, actor_id, is_demo, created_at)
     VALUES ('NK-TP-001', ?, 'TP/26/10/21-C1-01', 'IN', 9600, 9600, 'SHIFT_REPORT', ?, 'BC-261021-01', 'Nhập kho thành phẩm sau QC theo ca', ?, 1, '2026-10-21T15:00:00.000Z')`
  ).run(batch1Id, sr1Id, warehouse1Id);

  // Batch 2 (Grade B, IN_STOCK, 8,200 kg)
  const sr2Id = Number(
    db
      .prepare(
        `INSERT INTO shift_reports (code, batch_code, plan_id, production_date, shift, staff_id, nvl_used_kg, output_kg, note, status, submitted_at, reviewed_by, reviewed_at, is_demo, created_at, updated_at)
         VALUES ('BC-261022-01', 'TP/26/10/22-C1-01', ?, '2026-10-22', 'Ca 1', ?, 10000, 8200, 'Đóng 10 bao Jumbo + 200 kg lẻ [Mẫu thử nghiệm]', 'APPROVED', '2026-10-22T14:20:00.000Z', ?, '2026-10-22T14:40:00.000Z', 1, '2026-10-22T14:20:00.000Z', '2026-10-22T14:40:00.000Z')`
      )
      .run(plan2Id, staff1Id, managerId).lastInsertRowid
  );
  const batch2Id = Number(
    db
      .prepare(
        `INSERT INTO finished_batches (batch_code, shift_report_id, plan_id, production_date, shift, producer_id, produced_kg, initial_kg, dispatched_kg, available_kg, grade, qc_status, warehouse_status, packaging_info, received_by, received_at, is_demo, created_at, updated_at)
         VALUES ('TP/26/10/22-C1-01', ?, ?, '2026-10-22', 'Ca 1', ?, 8200, 8200, 3000, 5200, 'Grade B', 'INSPECTED', 'IN_STOCK', 'Bao Jumbo 800 kg', ?, '2026-10-22T15:20:00.000Z', 1, '2026-10-22T14:40:00.000Z', '2026-10-23T11:00:00.000Z')`
      )
      .run(sr2Id, plan2Id, staff1Id, warehouse1Id).lastInsertRowid
  );
  const qc2InspId = Number(
    db
      .prepare(
        `INSERT INTO qc_inspections (code, inspection_type, batch_id, grade, inspection_result, moisture_note, durability_note, appearance_note, foreign_matter_note, note, inspector_id, inspected_at, is_demo)
         VALUES ('QC-CA-002', 'SHIFT_QC', ?, 'Grade B', 'PASSED', 'Độ ẩm đạt yêu cầu bảo quản', 'Độ nén chắc chắn', 'Màu nâu sẫm hơn Grade A do tỷ lệ vỏ cây', 'Không có tạp chất lạ', 'Phân loại thương mại Grade B [Mẫu thử nghiệm]', ?, '2026-10-22T15:00:00.000Z', 1)`
      )
      .run(batch2Id, qc1Id).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
     VALUES ('QC', ?, 'Ảnh kiểm tra QC theo ca', 'qc-tp-261022-c1-01.svg', ?, 'image/svg+xml', 1390, ?, '2026-10-22T15:00:00.000Z')`
  ).run(qc2InspId, qcPhoto2Url, qc1Id);
  db.prepare(
    `INSERT INTO finished_goods_ledger (tx_code, batch_id, batch_code, tx_type, quantity_kg, balance_after_kg, reference_type, reference_id, reference_code, note, actor_id, is_demo, created_at)
     VALUES ('NK-TP-002', ?, 'TP/26/10/22-C1-01', 'IN', 8200, 8200, 'SHIFT_REPORT', ?, 'BC-261022-01', 'Nhập kho thành phẩm Grade B', ?, 1, '2026-10-22T15:20:00.000Z')`
  ).run(batch2Id, sr2Id, warehouse1Id);

  // Completed Outbound #1 on Grade B (proving Grade B is a valid commercial product & showing Receivable!)
  const out1Id = Number(
    db
      .prepare(
        `INSERT INTO outbound_orders (
          code, customer_id, product_name, requested_kg, accepted_grade, unit_price, total_value, expected_date, note,
          manager_id, has_qc_discrepancy, owner_id, owner_decision_at,
          recipient_name, recipient_phone, vehicle_plate, delivery_note, dispatched_kg,
          status, is_demo, created_at, updated_at
        ) VALUES (
          'XH-261023-01', ?, 'Viên gỗ nén', 3000, 'Grade B', 3100, 9300000, '2026-10-23', 'Xuất thương mại Grade B đợt 1 [Mẫu thử nghiệm]',
          ?, 0, ?, '2026-10-23T09:30:00.000Z',
          'Lê Văn Tài', '0988776655', '61C-458.12', 'Giao tại kho nhà máy BATT', 3000,
          'DISPATCHED', 1, '2026-10-23T08:00:00.000Z', '2026-10-23T11:00:00.000Z'
        )`
      )
      .run(cust2Id, managerId, ownerId).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO outbound_allocations (outbound_order_id, batch_id, allocated_kg, dispatched_kg) VALUES (?, ?, 3000, 3000)`
  ).run(out1Id, batch2Id);
  db.prepare(
    `INSERT INTO outbound_dispatches (code, outbound_order_id, batch_id, dispatched_kg, recipient_name, recipient_phone, vehicle_plate, note, warehouse_keeper_id, dispatched_at, is_demo)
     VALUES ('BG-261023-01', ?, ?, 3000, 'Lê Văn Tài', '0988776655', '61C-458.12', 'Đã cân xuất và bàn giao đủ 3.000 kg', ?, '2026-10-23T11:00:00.000Z', 1)`
  ).run(out1Id, batch2Id, warehouse1Id);
  db.prepare(
    `INSERT INTO finished_goods_ledger (tx_code, batch_id, batch_code, tx_type, quantity_kg, balance_after_kg, reference_type, reference_id, reference_code, note, actor_id, is_demo, created_at)
     VALUES ('XK-TP-001', ?, 'TP/26/10/22-C1-01', 'OUT', 3000, 5200, 'OUTBOUND_DISPATCH', ?, 'XH-261023-01', 'Bàn giao thực tế đơn XH-261023-01', ?, 1, '2026-10-23T11:00:00.000Z')`
  ).run(batch2Id, out1Id, warehouse1Id);

  // Receivable for Outbound #1 (UNPAID by default -> 0 collected, 9,300,000 remaining!)
  db.prepare(
    `INSERT INTO receivables (code, customer_id, outbound_order_id, delivery_date, total_amount, paid_amount, remaining_amount, status, is_demo, created_at, updated_at)
     VALUES ('CN-PTHU-001', ?, ?, '2026-10-23', 9300000, 0, 9300000, 'UNPAID', 1, '2026-10-23T11:00:00.000Z', '2026-10-23T11:00:00.000Z')`
  ).run(cust2Id, out1Id);

  // Outbound #2: Waiting for Owner Decision (allocated from FIFO Shift-QC Grade A batch)
  const out2Id = Number(
    db
      .prepare(
        `INSERT INTO outbound_orders (
          code, customer_id, product_name, requested_kg, accepted_grade, unit_price, total_value, expected_date, note,
          manager_id, has_qc_discrepancy, status, is_demo, created_at, updated_at
        ) VALUES (
          'XH-261024-01', ?, 'Viên gỗ nén', 4000, 'Grade A', 3450, 13800000, '2026-10-25', 'Đơn xuất 4 tấn Grade A theo đề xuất FIFO chờ Chủ DN phê duyệt [Mẫu thử nghiệm]',
          ?, 0, 'PENDING_OWNER', 1, '2026-10-24T05:00:00.000Z', '2026-10-24T05:50:00.000Z'
        )`
      )
      .run(cust1Id, managerId).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO outbound_allocations (outbound_order_id, batch_id, allocated_kg, dispatched_kg) VALUES (?, ?, 4000, 0)`
  ).run(out2Id, batch1Id);

  // Maintenance Request #1: Submitted by Staff, waiting for Manager to assign
  const maintReq1Id = Number(
    db
      .prepare(
        `INSERT INTO maintenance_requests (code, machine_id, plan_id, requested_by, issue_type, severity, description, status, is_demo, created_at, updated_at)
         VALUES ('BT-261024-01', ?, ?, ?, 'Cơ khí - Vòng bi', 'Cần xử lý trong ca', 'Bạc đạn gối đỡ trống sấy phát tiếng kêu bất thường khi chạy tải [Mẫu thử nghiệm]', 'NEW_ISSUE', 1, '2026-10-24T05:45:00.000Z', '2026-10-24T05:45:00.000Z')`
      )
      .run(machine2Id, plan3Id, staff1Id).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO attachments (entity_type, entity_id, doc_type, file_name, file_url, mime_type, file_size, uploaded_by, created_at)
     VALUES ('MAINTENANCE', ?, 'Ảnh hiện trường sự cố', 'su-co-bt-261024-01.svg', ?, 'image/svg+xml', 1350, ?, '2026-10-24T05:45:00.000Z')`
  ).run(maintReq1Id, machinePhotoUrl, staff1Id);

  // Spare Part Request #1 with multiple items for independent Manager approval
  const spReq1Id = Number(
    db
      .prepare(
        `INSERT INTO spare_part_requests (code, maintenance_request_id, requested_by, note, is_demo, created_at)
         VALUES ('VT-261024-01', ?, ?, 'Đề xuất vật tư thay thế dự phòng cho cụm sấy [Mẫu thử nghiệm]', 1, '2026-10-24T05:55:00.000Z')`
      )
      .run(maintReq1Id, maint1Id).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO spare_part_items (spare_part_request_id, item_name, quantity, unit, spec_note, status)
     VALUES (?, 'Vòng bi cầu tự lựa SKF 22216 E', 2, 'bộ', 'Chịu nhiệt cụm gối đỡ', 'PENDING')`
  ).run(spReq1Id);
  db.prepare(
    `INSERT INTO spare_part_items (spare_part_request_id, item_name, quantity, unit, spec_note, status)
     VALUES (?, 'Mỡ bò chịu nhiệt công nghiệp', 4, 'hộp', 'Loại 1kg/hộp', 'PENDING')`
  ).run(spReq1Id);

  // Initial Notifications for relevant actors
  const insertNotif = db.prepare(
    `INSERT INTO notifications (user_id, dedup_key, title, message, target_path, reference_code, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  );
  insertNotif.run(
    ownerId,
    'seed-out-owner-xh-261024-01',
    'Yêu cầu xuất hàng chờ quyết định',
    'Đơn xuất XH-261024-01 (4.000 kg Grade A) theo đề xuất FIFO đang chờ Chủ doanh nghiệp xem xét phê duyệt.',
    '/duyet-xuat-hang',
    'XH-261024-01',
    '2026-10-24T05:50:00.000Z'
  );
  insertNotif.run(
    managerId,
    'seed-po-mgr-tm-261023-01',
    'Phiếu thu mua chờ duyệt',
    'Phiếu TM-261023-01 (18.500 kg NVL) đã được gửi và đang chờ Quản lý xưởng duyệt.',
    '/thu-mua',
    'TM-261023-01',
    '2026-10-23T15:30:00.000Z'
  );
  insertNotif.run(
    managerId,
    'seed-maint-mgr-bt-261024-01',
    'Yêu cầu bảo trì mới',
    'Công nhân gửi yêu cầu sự cố máy BT-261024-01 cần tiếp nhận và phân công.',
    '/su-co-may-moc',
    'BT-261024-01',
    '2026-10-24T05:45:00.000Z'
  );
  insertNotif.run(
    warehouse1Id,
    'seed-po-wh-tm-261023-02',
    'Phiếu thu mua chờ nhận NVL',
    'Phiếu TM-261023-02 (14.000 kg NVL) đã được duyệt, chờ Thủ kho xác nhận thực nhận.',
    '/nhap-kho-nvl',
    'TM-261023-02',
    '2026-10-23T17:00:00.000Z'
  );
  insertNotif.run(
    purchasing1Id,
    'seed-po-pur-tm-261024-01',
    'Yêu cầu thu mua mới được giao',
    'Quản lý xưởng đã giao yêu cầu thu mua TM-261024-01.',
    '/thu-mua',
    'TM-261024-01',
    '2026-10-24T05:30:00.000Z'
  );
}

function migrateRemovePreOutboundQc(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM attachments
    WHERE entity_type = 'QC'
      AND entity_id IN (SELECT id FROM qc_inspections WHERE inspection_type = 'PRE_OUTBOUND_QC');

    DELETE FROM qc_inspections WHERE inspection_type = 'PRE_OUTBOUND_QC';

    UPDATE outbound_orders
    SET has_qc_discrepancy = 0,
        status = CASE
          WHEN status IN ('PENDING_PRE_QC', 'PRE_QC_DONE', 'RECHECK_QC') THEN 'PENDING_OWNER'
          ELSE status
        END
    WHERE has_qc_discrepancy != 0
       OR status IN ('PENDING_PRE_QC', 'PRE_QC_DONE', 'RECHECK_QC');

    UPDATE outbound_orders
    SET note = 'Đơn xuất 4 tấn Grade A theo đề xuất FIFO chờ Chủ DN phê duyệt [Mẫu thử nghiệm]'
    WHERE code = 'XH-261024-01' AND is_demo = 1 AND note LIKE '%QC trước xuất%';

    DELETE FROM notifications WHERE target_path = '/qc-truoc-xuat';

    UPDATE notifications
    SET message = 'Đơn xuất XH-261024-01 (4.000 kg Grade A) theo đề xuất FIFO đang chờ Chủ doanh nghiệp xem xét phê duyệt.'
    WHERE dedup_key = 'seed-out-owner-xh-261024-01' AND message LIKE '%QC trước xuất%';
  `);
}
