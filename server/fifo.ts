import type { DatabaseSync } from 'node:sqlite';

export interface FifoCandidateBatch {
  batchId: number;
  batchCode: string;
  productionDate: string;
  shift: string;
  grade: string;
  qcStatus: string;
  physicalAvailableKg: number;
  reservedByOtherOrdersKg: number;
  allocatableKg: number;
  proposedKg: number;
}

export interface FifoProposalResult {
  requestedKg: number;
  acceptedGrade: string;
  totalAllocatableKg: number;
  allocatedTotalKg: number;
  shortageKg: number;
  isSufficient: boolean;
  allocations: FifoCandidateBatch[];
}

function shiftOrderValue(shift: string): number {
  if (shift === 'Ca 1') return 1;
  if (shift === 'Ca 2') return 2;
  if (shift === 'Ca 3') return 3;
  return 9;
}

export function computeFifoProposal(
  db: DatabaseSync,
  requestedKg: number,
  acceptedGrade: string,
  excludeOutboundOrderId?: number
): FifoProposalResult {
  const gradeClause =
    acceptedGrade === 'Grade A'
      ? `AND fb.grade = 'Grade A'`
      : acceptedGrade === 'Grade B'
        ? `AND fb.grade = 'Grade B'`
        : `AND fb.grade IN ('Grade A', 'Grade B')`;

  const excludeClause = excludeOutboundOrderId ? `AND o.id != ${Number(excludeOutboundOrderId)}` : '';

  const rows = db
    .prepare(
      `SELECT
        fb.id as batchId,
        fb.batch_code as batchCode,
        fb.production_date as productionDate,
        fb.shift as shift,
        fb.grade as grade,
        fb.qc_status as qcStatus,
        fb.available_kg as physicalAvailableKg,
        COALESCE((
          SELECT SUM(oa.allocated_kg - oa.dispatched_kg)
          FROM outbound_allocations oa
          JOIN outbound_orders o ON o.id = oa.outbound_order_id
          WHERE oa.batch_id = fb.id
            AND o.status NOT IN ('REJECTED', 'DISPATCHED')
            AND (oa.allocated_kg - oa.dispatched_kg) > 0
            ${excludeClause}
        ), 0) as reservedByOtherOrdersKg
       FROM finished_batches fb
       WHERE fb.warehouse_status = 'IN_STOCK'
         AND fb.qc_status = 'INSPECTED'
         AND fb.available_kg > 0
         ${gradeClause}`
    )
    .all() as Array<Record<string, unknown>>;

  // Sort strictly oldest to newest (FIFO): productionDate ASC -> shift ASC -> batchId ASC
  const sorted = rows
    .map((r) => {
      const physical = Number(r.physicalAvailableKg);
      const reserved = Math.max(0, Number(r.reservedByOtherOrdersKg));
      const allocatable = Math.max(0, Math.round((physical - reserved) * 100) / 100);
      return {
        batchId: Number(r.batchId),
        batchCode: String(r.batchCode),
        productionDate: String(r.productionDate),
        shift: String(r.shift),
        grade: String(r.grade),
        qcStatus: String(r.qcStatus),
        physicalAvailableKg: physical,
        reservedByOtherOrdersKg: reserved,
        allocatableKg: allocatable,
        proposedKg: 0,
      };
    })
    .filter((b) => b.allocatableKg > 0)
    .sort((a, b) => {
      if (a.productionDate !== b.productionDate) {
        return a.productionDate.localeCompare(b.productionDate);
      }
      const sDiff = shiftOrderValue(a.shift) - shiftOrderValue(b.shift);
      if (sDiff !== 0) return sDiff;
      return a.batchId - b.batchId;
    });

  let remainingNeed = Math.max(0, requestedKg);
  const allocations: FifoCandidateBatch[] = [];
  let totalAllocatableKg = 0;

  for (const batch of sorted) {
    totalAllocatableKg += batch.allocatableKg;
    if (remainingNeed > 0) {
      const take = Math.min(batch.allocatableKg, remainingNeed);
      remainingNeed = Math.round((remainingNeed - take) * 100) / 100;
      allocations.push({
        ...batch,
        proposedKg: take,
      });
    }
  }

  const allocatedTotalKg = Math.round((requestedKg - remainingNeed) * 100) / 100;
  const shortageKg = Math.max(0, remainingNeed);

  return {
    requestedKg,
    acceptedGrade,
    totalAllocatableKg: Math.round(totalAllocatableKg * 100) / 100,
    allocatedTotalKg,
    shortageKg,
    isSufficient: shortageKg === 0 && requestedKg > 0,
    allocations,
  };
}
