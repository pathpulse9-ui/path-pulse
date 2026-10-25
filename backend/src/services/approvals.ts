import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { toStroops } from '../stellar/settlement.js';

export type ApprovalAction = 'settlement' | 'converted_settlement' | 'group_payout';

export interface ApprovalRecord {
  id: string;
  action: ApprovalAction;
  requestBody: unknown;
  amount: string;
  requestedBy: string;
  approvedBy: string | null;
  status: 'pending' | 'executing' | 'executed' | 'failed' | 'expired';
  createdAt: string;
  expiresAt: string;
}

function fail(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

export function needsSecondApproval(amount: string, threshold = env.opsApproval.threshold): boolean {
  if (!threshold) return false;
  return toStroops(amount) > toStroops(threshold);
}

type Row = {
  id: string;
  action: ApprovalAction;
  request_body: unknown;
  amount: string;
  requested_by: string;
  approved_by: string | null;
  status: ApprovalRecord['status'];
  created_at: Date;
  expires_at: Date;
};

function toRecord(r: Row): ApprovalRecord {
  return {
    id: r.id,
    action: r.action,
    requestBody: r.request_body,
    amount: r.amount,
    requestedBy: r.requested_by,
    approvedBy: r.approved_by,
    status: r.status === 'pending' && r.expires_at.getTime() < Date.now() ? 'expired' : r.status,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
  };
}

export async function requestApproval(
  action: ApprovalAction,
  body: unknown,
  amount: string,
  requestedBy: string,
): Promise<ApprovalRecord> {
  if (!env.databaseUrl) throw fail('Two-operator approval needs the database', 503, 'ApprovalUnavailable');
  const id = `apr_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const r = await db().query<Row>(
    `insert into ops_approvals (id, action, request_body, request_hash, amount, requested_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)
     returning *`,
    [id, action, JSON.stringify(body), hash, amount, requestedBy, String(env.opsApproval.ttlSeconds)],
  );
  return toRecord(r.rows[0]);
}

export async function claimApproval(id: string, approver: string): Promise<ApprovalRecord> {
  if (!env.databaseUrl) throw fail('Two-operator approval needs the database', 503, 'ApprovalUnavailable');
  const client = await db().connect();
  try {
    await client.query('begin');
    const r = await client.query<Row>('select * from ops_approvals where id = $1 for update', [id]);
    const row = r.rows[0];
    if (!row) throw fail(`Approval ${id} not found`, 404, 'NotFound');
    if (row.status !== 'pending') throw fail(`Approval ${id} is already ${row.status}`, 409, 'ApprovalNotPending');
    if (row.expires_at.getTime() < Date.now()) throw fail(`Approval ${id} has expired`, 409, 'ApprovalExpired');
    if (row.requested_by === approver) {
      throw fail('A second, different operator must approve this request', 403, 'SameOperator');
    }
    const updated = await client.query<Row>(
      `update ops_approvals set status = 'executing', approved_by = $2 where id = $1 returning *`,
      [id, approver],
    );
    await client.query('commit');
    return toRecord(updated.rows[0]);
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function finishApproval(id: string, status: 'executed' | 'failed', result: unknown): Promise<void> {
  await db().query('update ops_approvals set status = $2, result = $3 where id = $1', [
    id,
    status,
    JSON.stringify(result ?? null),
  ]);
}

export async function listPendingApprovals(): Promise<ApprovalRecord[]> {
  if (!env.databaseUrl) return [];
  const r = await db().query<Row>(
    "select * from ops_approvals where status = 'pending' and expires_at > now() order by created_at desc limit 100",
  );
  return r.rows.map(toRecord);
}
