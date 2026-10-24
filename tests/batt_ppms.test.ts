import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Configure isolated temporary test directory BEFORE importing server modules
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batt-ppms-test-'));
process.env.BATT_DATA_DIR = tmpDir;
process.env.BATT_DB_PATH = path.join(tmpDir, 'test_batt_ppms.sqlite');

const { createApiApp } = await import('../server/app.ts');

interface TestCaseResult {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestCaseResult[] = [];

async function runCase(id: string, name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ id, name, passed: true, detail });
    console.log(`PASS [${id}] ${name} -> ${detail}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ id, name, passed: false, detail: msg });
    console.error(`FAIL [${id}] ${name} -> ${msg}`);
  }
}

const app = createApiApp();
const server = http.createServer(app);

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
const addr = server.address() as { port: number };
const BASE = `http://127.0.0.1:${addr.port}`;

async function api(
  method: string,
  urlPath: string,
  token: string | null,
  body?: unknown
): Promise<{ status: number; data: Record<string, any> }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let fetchBody: BodyInit | undefined;
  if (body instanceof FormData) {
    fetchBody = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: fetchBody,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, data };
}

async function uploadSvgEvidence(token: string, filename: string) {
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#f8fafc"/><text x="16" y="60" font-size="14">${filename}</text></svg>`;
  const form = new FormData();
  form.append('file', new Blob([svgContent], { type: 'image/svg+xml' }), filename);
  const res = await api('POST', '/api/uploads', token, form);
  assert.equal(res.status, 201, `Upload failed: ${JSON.stringify(res.data)}`);
  return res.data;
}

const tokens: Record<string, string> = {};
const users: Record<string, any> = {};

// 1. Multi-Actor Login & Inactive User Block
await runCase(
  'TC-01',
  'Đăng nhập đủ 8 vai trò nội bộ & chặn tài khoản ngừng sử dụng',
  async () => {
    const accounts = [
      'owner',
      'manager',
      'purchasing1',
      'warehouse1',
      'staff1',
      'staff2',
      'qc1',
      'maint1',
      'admin',
    ];
    for (const u of accounts) {
      const res = await api('POST', '/api/auth/login', null, {
        username: u,
        password: 'Batt@2026',
      });
      assert.equal(res.status, 200, `Login failed for ${u}`);
      assert.ok(res.data.token);
      tokens[u] = res.data.token;
      users[u] = res.data.user;
    }

    assert.equal(users.owner.roleLabel || 'Chủ doanh nghiệp', 'Chủ doanh nghiệp');

    const inactiveRes = await api('POST', '/api/auth/login', null, {
      username: 'inactive_user',
      password: 'Batt@2026',
    });
    assert.equal(inactiveRes.status, 403);
    return `9 tài khoản hoạt động đăng nhập thành công; inactive_user bị chặn HTTP 403`;
  }
);

// 2. RBAC & Self-Escalation / Session Invalidation Guards
await runCase(
  'TC-02',
  'Kiểm tra phân quyền RBAC chéo, chặn tự đổi vai trò & thu hồi phiên khi khóa tài khoản',
  async () => {
    // Self role change blocked on profile
    const selfEsc = await api('PUT', '/api/auth/profile', tokens.staff1, {
      fullName: 'Công nhân 1',
      role: 'OWNER',
    });
    assert.equal(selfEsc.status, 403);

    // Admin cannot self-change role or self-deactivate
    const adminSelfRole = await api('PUT', `/api/users/${users.admin.id}`, tokens.admin, {
      fullName: users.admin.fullName,
      role: 'OWNER',
      status: 'ACTIVE',
    });
    assert.equal(adminSelfRole.status, 403);

    const adminSelfDeact = await api('PUT', `/api/users/${users.admin.id}`, tokens.admin, {
      fullName: users.admin.fullName,
      role: 'ADMIN_SYSTEM',
      status: 'INACTIVE',
    });
    assert.equal(adminSelfDeact.status, 400);

    // Admin blocked from operational modules
    const adminPo = await api('GET', '/api/purchasing', tokens.admin);
    assert.equal(adminPo.status, 403);
    const adminFin = await api('GET', '/api/finance/receivables', tokens.admin);
    assert.equal(adminFin.status, 403);

    // Manager blocked from Owner-only Finance & Owner Outbound Approval
    const mgrFin = await api('GET', '/api/finance/payables', tokens.manager);
    assert.equal(mgrFin.status, 403);
    const mgrOwnerApprove = await api('POST', '/api/outbound/1/owner-decision', tokens.manager, {
      decision: 'APPROVE',
    });
    assert.equal(mgrOwnerApprove.status, 403);

    // Admin creates temporary user, logs in, deactivates -> immediate 401 session revocation
    const createTmp = await api('POST', '/api/users', tokens.admin, {
      fullName: 'Nhân sự Tạm',
      username: 'temp_worker',
      password: 'Batt@2026',
      role: 'STAFF',
    });
    assert.equal(createTmp.status, 201);
    const tmpId = createTmp.data.user.id;

    const tmpLogin = await api('POST', '/api/auth/login', null, {
      username: 'temp_worker',
      password: 'Batt@2026',
    });
    assert.equal(tmpLogin.status, 200);

    const deact = await api('PUT', `/api/users/${tmpId}`, tokens.admin, {
      fullName: 'Nhân sự Tạm',
      role: 'STAFF',
      status: 'INACTIVE',
    });
    assert.equal(deact.status, 200);

    const checkSession = await api('GET', '/api/auth/me', tmpLogin.data.token);
    assert.equal(checkSession.status, 401);

    return 'Chặn tự nâng quyền (403), chặn Admin vào nghiệp vụ (403), chặn Manager vào công nợ/duyệt xuất (403), thu hồi phiên ngay khi khóa tài khoản (401)';
  }
);

// 3. End-to-End Purchasing -> Approval (No Stock Increase) -> Warehouse Actual Receipt (1x Stock Increase + Discrepancy + Payable)
await runCase(
  'TC-03',
  'Luồng Thu mua NVL -> Duyệt phiếu -> Thủ kho nhận hàng thực tế & bảo toàn chênh lệch',
  async () => {
    const rawBefore = await api('GET', '/api/inventory/raw', tokens.warehouse1);
    const b0 = Number(rawBefore.data.stock.balanceKg);

    // Manager creates Purchasing Request
    const supRes = await api('GET', '/api/suppliers', tokens.manager);
    const activeSup = supRes.data.items.find((s: any) => s.status === 'ACTIVE');
    const createPo = await api('POST', '/api/purchasing', tokens.manager, {
      supplierId: activeSup.id,
      assignedTo: users.purchasing1.id,
      requestDate: '2026-10-24',
      requestNote: 'Thu mua NVL kiểm thử tự động',
    });
    assert.equal(createPo.status, 201);
    const poId = createPo.data.id;

    // Submit without scale ticket photo must fail
    const noPhoto = await api('PUT', `/api/purchasing/${poId}/result`, tokens.purchasing1, {
      weighedKg: 10000,
      unitPrice: 1500,
      submitForApproval: true,
    });
    assert.equal(noPhoto.status, 400);

    // Upload scale ticket photo & submit
    const scaleFile = await uploadSvgEvidence(tokens.purchasing1, 'phieu_can_test.svg');
    const submitPo = await api('PUT', `/api/purchasing/${poId}/result`, tokens.purchasing1, {
      weighedKg: 10000,
      unitPrice: 1500,
      purchasingNote: 'Đã cân tại trạm',
      submitForApproval: true,
      scaleTicketAttachment: scaleFile,
    });
    assert.equal(submitPo.status, 200);

    // Manager approves PO -> Stock MUST NOT increase yet!
    const appPo = await api('POST', `/api/purchasing/${poId}/decision`, tokens.manager, {
      decision: 'APPROVE',
    });
    assert.equal(appPo.status, 200);

    const rawAfterApprove = await api('GET', '/api/inventory/raw', tokens.warehouse1);
    assert.equal(
      Number(rawAfterApprove.data.stock.balanceKg),
      b0,
      'Duyệt phiếu thu mua KHÔNG được tăng tồn kho NVL'
    );

    // Warehouse Keeper receives 9,850 kg WITHOUT discrepancy note -> blocked 400
    const missingDiscNote = await api('POST', `/api/purchasing/${poId}/receive`, tokens.warehouse1, {
      receivedKg: 9850,
      discrepancyNote: '',
    });
    assert.equal(missingDiscNote.status, 400);

    // Warehouse Keeper receives 9,850 kg WITH discrepancy note -> increases stock ONCE by 9,850 kg
    const recPo = await api('POST', `/api/purchasing/${poId}/receive`, tokens.warehouse1, {
      receivedKg: 9850,
      discrepancyNote: 'Hao hụt độ ẩm bay hơi trên xe 150 kg',
    });
    assert.equal(recPo.status, 200);

    const rawAfterReceive = await api('GET', '/api/inventory/raw', tokens.warehouse1);
    assert.equal(Number(rawAfterReceive.data.stock.balanceKg), b0 + 9850);

    // Duplicate receipt blocked 409
    const dupRec = await api('POST', `/api/purchasing/${poId}/receive`, tokens.warehouse1, {
      receivedKg: 9850,
      discrepancyNote: 'Nhận trùng',
    });
    assert.equal(dupRec.status, 409);

    // Verify ticket weight preserved & payable created unpaid
    const poDetail = await api('GET', `/api/purchasing/${poId}`, tokens.owner);
    assert.equal(poDetail.data.order.weighedKg, 10000);
    assert.equal(poDetail.data.order.receivedKg, 9850);
    assert.equal(poDetail.data.order.discrepancyKg, -150);

    const payables = await api('GET', '/api/finance/payables', tokens.owner);
    const createdPayable = payables.data.items.find(
      (p: any) => p.purchasingCode === poDetail.data.order.code
    );
    assert.ok(createdPayable);
    assert.equal(createdPayable.totalAmount, 9850 * 1500);
    assert.equal(createdPayable.paidAmount, 0);

    return `Tồn NVL giữ nguyên ${b0} kg khi duyệt phiếu, tăng đúng +9,850 kg lên ${b0 + 9850} kg khi Thủ kho nhận, chặn nhận trùng (409), giữ nguyên cân phiếu 10,000 kg`;
  }
);

// 4. End-to-End Production Plan -> NVL Issue -> Shift Report (Reject & Resubmit Batch Code Invariant) -> Shift QC -> Finished Goods Receipt
let e2eBatchId = 0;
let e2eBatchCode = '';

await runCase(
  'TC-04',
  'Luồng Kế hoạch SX -> Cấp NVL -> Báo cáo ca (giữ mã lô khi sửa) -> QC theo ca -> Tiếp nhận thành phẩm',
  async () => {
    const rawBefore = await api('GET', '/api/inventory/raw', tokens.warehouse1);
    const nvlAvail = Number(rawBefore.data.stock.balanceKg);

    const fgBefore = await api('GET', '/api/inventory/finished', tokens.warehouse1);
    const fg0 = Number(fgBefore.data.summary.totalAvailableKg);

    // Manager creates plan
    const dir = await api('GET', '/api/directory/options', tokens.manager);
    const createPlan = await api('POST', '/api/production/plans', tokens.manager, {
      planDate: '2026-10-25',
      shift: 'Ca 1',
      targetKg: 4200,
      machineId: dir.data.machines[0].id,
      assignments: [{ staffId: users.staff1.id, taskRole: 'Vận hành máy ép viên' }],
    });
    assert.equal(createPlan.status, 201);
    const planId = createPlan.data.id;

    // Staff blocked from completing plan
    const staffComplete = await api('POST', `/api/production/plans/${planId}/complete`, tokens.staff1);
    assert.equal(staffComplete.status, 403);

    // Warehouse Keeper blocked from issuing > available NVL
    const overIssue = await api('POST', '/api/warehouse/raw-issues', tokens.warehouse1, {
      planId,
      receiverId: users.staff1.id,
      quantityKg: nvlAvail + 5000,
    });
    assert.equal(overIssue.status, 400);

    // Warehouse Keeper issues 5,000 kg NVL + 52 reference buckets
    const issueRes = await api('POST', '/api/warehouse/raw-issues', tokens.warehouse1, {
      planId,
      receiverId: users.staff1.id,
      quantityKg: 5000,
      estimatedBuckets: 52,
      note: 'Cấp NVL ca 1',
    });
    assert.equal(issueRes.status, 201);

    const rawAfterIssue = await api('GET', '/api/inventory/raw', tokens.warehouse1);
    assert.equal(
      Number(rawAfterIssue.data.stock.balanceKg),
      nvlAvail - 5000,
      'Tồn kho NVL phải trừ theo khối lượng thực cấp 5,000 kg chứ không tính theo số gầu'
    );

    // Staff submits shift report -> unique batch code generated, FG stock unchanged
    const srCreate = await api('POST', '/api/production/shift-reports', tokens.staff1, {
      planId,
      nvlUsedKg: 5000,
      outputKg: 4200,
      note: 'Báo cáo lần 1',
    });
    assert.equal(srCreate.status, 201);
    const srId = srCreate.data.id;
    e2eBatchCode = srCreate.data.batchCode;
    assert.match(e2eBatchCode, /^TP\/26\/10\/25-C1-\d{2}$/);

    // Manager rejects shift report -> Staff edits & resubmits -> batchCode MUST NOT change!
    const srRej = await api('POST', `/api/production/shift-reports/${srId}/decision`, tokens.manager, {
      decision: 'REJECT',
      reason: 'Kiểm tra lại NVL còn dư cuối ca',
    });
    assert.equal(srRej.status, 200);

    const srResubmit = await api('PUT', `/api/production/shift-reports/${srId}`, tokens.staff1, {
      nvlUsedKg: 4920,
      outputKg: 4200,
      note: 'Đã đối chiếu lại NVL cuối ca',
    });
    assert.equal(srResubmit.status, 200);

    const srDetail = await api('GET', `/api/production/shift-reports/${srId}`, tokens.staff1);
    assert.equal(srDetail.data.report.batchCode, e2eBatchCode, 'Mã lô phải giữ nguyên khi gửi lại');

    // Manager approves shift report -> FG stock STILL unchanged (0 increase)
    const srApp = await api('POST', `/api/production/shift-reports/${srId}/decision`, tokens.manager, {
      decision: 'APPROVE',
    });
    assert.equal(srApp.status, 200);

    const fgAfterSrApprove = await api('GET', '/api/inventory/finished', tokens.warehouse1);
    assert.equal(Number(fgAfterSrApprove.data.summary.totalAvailableKg), fg0);

    // Find created batch
    const qcList = await api('GET', '/api/qc/shift', tokens.qc1);
    const createdBatch = qcList.data.items.find((b: any) => b.batchCode === e2eBatchCode);
    assert.ok(createdBatch);
    e2eBatchId = createdBatch.id;

    // Warehouse Keeper blocked from receiving batch BEFORE Shift QC
    const earlyFgRec = await api(
      'POST',
      `/api/warehouse/finished-receipts/${e2eBatchId}`,
      tokens.warehouse1,
      { receivedKg: 4200 }
    );
    assert.equal(earlyFgRec.status, 400);

    // QC Staff performs Shift QC (Grade A) with photo -> FG stock STILL unchanged
    const qcPhoto = await uploadSvgEvidence(tokens.qc1, 'qc_ca_test.svg');
    const shiftQcRes = await api('POST', `/api/qc/shift/${e2eBatchId}`, tokens.qc1, {
      grade: 'Grade A',
      inspectionResult: 'PASSED',
      moistureNote: '7.6%',
      durabilityNote: '98.2%',
      appearanceNote: 'Sáng đều',
      evidenceAttachment: qcPhoto,
    });
    assert.equal(shiftQcRes.status, 201);

    const fgAfterQc = await api('GET', '/api/inventory/finished', tokens.warehouse1);
    assert.equal(Number(fgAfterQc.data.summary.totalAvailableKg), fg0);

    // Warehouse Keeper confirms Finished Goods Receipt -> increases FG stock ONCE by 4,200 kg
    const fgRec = await api(
      'POST',
      `/api/warehouse/finished-receipts/${e2eBatchId}`,
      tokens.warehouse1,
      { receivedKg: 4200, packagingInfo: 'Bao Jumbo 1 tấn' }
    );
    assert.equal(fgRec.status, 200);

    const fgAfterRec = await api('GET', '/api/inventory/finished', tokens.warehouse1);
    assert.equal(Number(fgAfterRec.data.summary.totalAvailableKg), fg0 + 4200);

    // Duplicate Finished Goods receipt blocked 409
    const dupFgRec = await api(
      'POST',
      `/api/warehouse/finished-receipts/${e2eBatchId}`,
      tokens.warehouse1,
      { receivedKg: 4200 }
    );
    assert.equal(dupFgRec.status, 409);

    return `Mã lô ${e2eBatchCode} bất biến qua từ chối/gửi lại; tồn thành phẩm tăng đúng 1 lần +4,200 kg khi Thủ kho xác nhận nhận`;
  }
);

// 5. End-to-End Outbound FIFO (Shift QC only) -> Direct Owner Approval -> Partial & Full Dispatch + Receivable
await runCase(
  'TC-05',
  'Luồng Xuất hàng FIFO (dựa trên QC theo ca, không có QC trước xuất) -> Chủ DN duyệt -> Bàn giao 1 phần & đủ đơn -> Công nợ phải thu',
  async () => {
    const fgBefore = await api('GET', '/api/inventory/finished', tokens.warehouse1);
    const fgStart = Number(fgBefore.data.summary.totalAvailableKg);

    const custRes = await api('GET', '/api/customers', tokens.manager);
    const gradeACust = custRes.data.items.find(
      (c: any) => c.status === 'ACTIVE' && c.acceptedGrade === 'Grade A'
    );

    // Outbound exceeding available stock must fail 400
    const overOutbound = await api('POST', '/api/outbound', tokens.manager, {
      customerId: gradeACust.id,
      requestedKg: 999999,
      acceptedGrade: 'Grade A',
      unitPrice: 3400,
      expectedDate: '2026-10-26',
    });
    assert.equal(overOutbound.status, 400);

    // Create valid Outbound Order (3,000 kg Grade A) -> FIFO picks oldest Grade A batch first and enters PENDING_OWNER directly!
    const createOut = await api('POST', '/api/outbound', tokens.manager, {
      customerId: gradeACust.id,
      requestedKg: 3000,
      acceptedGrade: 'Grade A',
      unitPrice: 3400,
      expectedDate: '2026-10-26',
      note: 'Đơn kiểm thử FIFO trình thẳng Chủ DN',
    });
    assert.equal(createOut.status, 201);
    const orderId = createOut.data.id;

    // Verify Pre-Outbound QC endpoint no longer exists (404)
    const removedPreQc = await api('POST', `/api/qc/pre-outbound/${orderId}`, tokens.qc1, {
      batchId: 1,
      grade: 'Grade A',
    });
    assert.equal(removedPreQc.status, 404);

    const detail0 = await api('GET', `/api/outbound/${orderId}`, tokens.owner);
    assert.equal(detail0.data.order.status, 'PENDING_OWNER');
    const allocs = detail0.data.allocations as Array<any>;
    assert.ok(allocs.length >= 1);
    assert.ok(detail0.data.shiftQcInspections.length >= 1, 'Phải hiển thị hồ sơ QC theo ca của lô phân bổ');

    // Verify FIFO chronological order
    for (let i = 1; i < allocs.length; i++) {
      assert.ok(allocs[i - 1].productionDate <= allocs[i].productionDate);
    }

    // Owner reject without reason must fail 400
    const rejNoReason = await api('POST', `/api/outbound/${orderId}/owner-decision`, tokens.owner, {
      decision: 'REJECT',
      reason: '',
    });
    assert.equal(rejNoReason.status, 400);

    // Owner approves -> FG stock MUST STILL equal fgStart!
    const ownerApp = await api('POST', `/api/outbound/${orderId}/owner-decision`, tokens.owner, {
      decision: 'APPROVE',
    });
    assert.equal(ownerApp.status, 200);

    const fgAfterOwnerApprove = await api('GET', '/api/inventory/finished', tokens.warehouse1);
    assert.equal(
      Number(fgAfterOwnerApprove.data.summary.totalAvailableKg),
      fgStart,
      'Chủ doanh nghiệp duyệt xuất KHÔNG được trừ tồn kho trước khi Thủ kho bàn giao'
    );

    // Warehouse Keeper blocked before recipient/plate info
    const earlyDisp = await api('POST', `/api/outbound/${orderId}/dispatch`, tokens.warehouse1, {
      lines: [{ batchId: allocs[0].batchId, dispatchedKg: 1000 }],
    });
    assert.equal(earlyDisp.status, 400);

    // Manager updates recipient & vehicle plate
    const updRecip = await api('PUT', `/api/outbound/${orderId}/recipient`, tokens.manager, {
      recipientName: 'Trần Văn Tài',
      recipientPhone: '0912345678',
      vehiclePlate: '43C-888.99',
    });
    assert.equal(updRecip.status, 200);

    // Partial Dispatch #1: 1,000 kg from first allocated batch
    const firstPartKg = Math.min(1000, Number(allocs[0].allocatedKg));
    const disp1 = await api('POST', `/api/outbound/${orderId}/dispatch`, tokens.warehouse1, {
      lines: [{ batchId: allocs[0].batchId, dispatchedKg: firstPartKg }],
      note: 'Giao xe chuyến 1',
    });
    assert.equal(disp1.status, 200);
    assert.equal(disp1.data.nextStatus, 'PARTIALLY_DISPATCHED');

    const fgAfterPart = await api('GET', '/api/inventory/finished', tokens.warehouse1);
    assert.equal(Number(fgAfterPart.data.summary.totalAvailableKg), fgStart - firstPartKg);

    // Remaining Full Dispatch #2: dispatch remaining allocated quantities
    const detailMid = await api('GET', `/api/outbound/${orderId}`, tokens.warehouse1);
    const remLines = detailMid.data.allocations
      .map((a: any) => ({
        batchId: a.batchId,
        dispatchedKg: Math.round((Number(a.allocatedKg) - Number(a.dispatchedKg)) * 100) / 100,
      }))
      .filter((l: any) => l.dispatchedKg > 0);

    const disp2 = await api('POST', `/api/outbound/${orderId}/dispatch`, tokens.warehouse1, {
      lines: remLines,
      note: 'Giao hoàn tất chuyến 2',
    });
    assert.equal(disp2.status, 200);
    assert.equal(disp2.data.nextStatus, 'DISPATCHED');

    const fgAfterFull = await api('GET', '/api/inventory/finished', tokens.warehouse1);
    assert.equal(Number(fgAfterFull.data.summary.totalAvailableKg), fgStart - 3000);

    // Duplicate dispatch on DISPATCHED order blocked 400
    const dupDisp = await api('POST', `/api/outbound/${orderId}/dispatch`, tokens.warehouse1, {
      lines: [{ batchId: allocs[0].batchId, dispatchedKg: 100 }],
    });
    assert.equal(dupDisp.status, 400);

    // Verify Receivable created strictly from actual dispatched weight * price with paidAmount = 0
    const recRes = await api('GET', '/api/finance/receivables', tokens.owner);
    const orderRec = recRes.data.items.find(
      (r: any) => r.outboundCode === detail0.data.order.code
    );
    assert.ok(orderRec);
    assert.equal(orderRec.totalAmount, 3000 * 3400);
    assert.equal(orderRec.paidAmount, 0);
    assert.equal(orderRec.status, 'UNPAID');

    return `FIFO chuẩn dựa trên QC theo ca, trình thẳng Chủ DN duyệt chưa trừ kho, bàn giao 2 đợt trừ đúng 3,000 kg, công nợ phải thu tạo tự động trạng thái UNPAID`;
  }
);

// 6. End-to-End Maintenance & Independent Spare Part Item Approval
await runCase(
  'TC-06',
  'Luồng Sự cố máy móc & Duyệt độc lập từng hạng mục vật tư bảo trì',
  async () => {
    const dir = await api('GET', '/api/directory/options', tokens.staff1);
    const createMaint = await api('POST', '/api/maintenance/requests', tokens.staff1, {
      machineId: dir.data.machines[0].id,
      issueType: 'Cơ khí',
      severity: 'Cần xử lý trong ca',
      description: 'Rung nhẹ trục chính máy ép',
    });
    assert.equal(createMaint.status, 201);
    const maintId = createMaint.data.id;

    // Manager receives & assigns atomically
    const assignRes = await api('POST', `/api/maintenance/requests/${maintId}/assign`, tokens.manager, {
      assignedTo: users.maint1.id,
      assignmentNote: 'Kiểm tra bạc đạn trục chính',
    });
    assert.equal(assignRes.status, 200);

    // Maint1 creates 2-item spare part request
    const createSp = await api('POST', '/api/maintenance/spare-parts', tokens.maint1, {
      maintenanceRequestId: maintId,
      note: 'Vật tư thay thế ca chiều',
      lineItems: [
        { itemName: 'Vòng bi SKF 6314', quantity: 2, unit: 'cái', specNote: 'Chịu nhiệt' },
        { itemName: 'Dây curoa bản C', quantity: 4, unit: 'sợi', specNote: 'Dự phòng thêm' },
      ],
    });
    assert.equal(createSp.status, 201);

    const spList = await api('GET', '/api/maintenance/spare-parts', tokens.manager);
    const spReq = spList.data.items.find((r: any) => r.id === createSp.data.id);
    assert.equal(spReq.lineItems.length, 2);

    // Manager approves Item #1 and rejects Item #2 independently!
    const appItem1 = await api(
      'PUT',
      `/api/maintenance/spare-part-items/${spReq.lineItems[0].id}/decision`,
      tokens.manager,
      { decision: 'APPROVED' }
    );
    assert.equal(appItem1.status, 200);

    const rejItem2 = await api(
      'PUT',
      `/api/maintenance/spare-part-items/${spReq.lineItems[1].id}/decision`,
      tokens.manager,
      { decision: 'REJECTED', reason: 'Dây curoa cũ vẫn còn tốt, chưa cần thay' }
    );
    assert.equal(rejItem2.status, 200);

    const spVerify = await api('GET', '/api/maintenance/spare-parts', tokens.maint1);
    const updatedSp = spVerify.data.items.find((r: any) => r.id === createSp.data.id);
    assert.equal(updatedSp.lineItems[0].status, 'APPROVED');
    assert.equal(updatedSp.lineItems[1].status, 'REJECTED');

    // Maint1 starts & submits completion report; cannot self-confirm!
    await api('PUT', `/api/maintenance/requests/${maintId}/progress`, tokens.maint1, {
      mode: 'START',
    });
    await api('PUT', `/api/maintenance/requests/${maintId}/progress`, tokens.maint1, {
      mode: 'REPORT',
      repairResult: 'Đã thay 02 vòng bi SKF 6314, máy chạy êm',
      materialsUsed: '02 vòng bi SKF 6314',
    });

    const selfConfirm = await api(
      'POST',
      `/api/maintenance/requests/${maintId}/confirm`,
      tokens.maint1,
      { decision: 'CONFIRM' }
    );
    assert.equal(selfConfirm.status, 403);

    // Manager confirms completion
    const mgrConfirm = await api(
      'POST',
      `/api/maintenance/requests/${maintId}/confirm`,
      tokens.manager,
      { decision: 'CONFIRM' }
    );
    assert.equal(mgrConfirm.status, 200);

    return 'Tiếp nhận + giao việc 1 bước, duyệt độc lập từng mục vật tư (Mục 1 APPROVED, Mục 2 REJECTED), chặn nhân viên bảo trì tự nghiệm thu (403)';
  }
);

server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.passed);
console.log(`\n=== TỔNG KẾT KIỂM THỬ TỰ ĐỘNG BATT PPMS: ${results.length - failed.length}/${results.length} PASS ===`);
if (failed.length > 0) {
  process.exit(1);
}
