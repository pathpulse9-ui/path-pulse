/**
 * D4 evidence: a dropped Carret webhook is recovered by the reconciler, and the
 * recovered session stays linked to the settlement batch it draws from.
 *
 * Prints the reviewer-facing transcript: the persisted session, its full status
 * event timeline (`create` → `reconciler`), and a redacted Carret order record
 * carrying amount, final status, timestamps, the PathPulse session and the
 * settlement batch id.
 *
 * Two modes:
 *
 *   --order <id>   Live. Reads the real Carret order from `GET /offramp/orders/`
 *                  via the whitelisted egress proxy, binds it to a session that
 *                  never received its webhook, and reconciles against it.
 *
 *   (default)      Offline. Same code path, same tables, same event rows, with
 *                  the Carret order list supplied as a fixture. Nothing is
 *                  placed on Carret and no funds move.
 *
 *   pnpm --filter @pathpulse/backend exec tsx scripts/demo-offramp-recovery.ts \
 *     --batch <settlement-batch-id> [--order <carret-order-id>] [--keep]
 */
import { randomBytes } from 'node:crypto';
import { env } from '../src/config/env.js';
import { migrate, db, closeDb } from '../src/db/client.js';
import { getSettlementBatch } from '../src/stellar/settlement.js';
import { saveSession, getSession, listEvents } from '../src/services/offRampStore.js';
import { reconcileOnce, type ReconcileDeps } from '../src/services/orphanReconciler.js';
import { listOfframpOrders, type CarretOrder } from '../src/services/carret.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function redactOrder(o: CarretOrder, sessionId: string, batchId: string) {
  return {
    carret_order_id: String(o.id),
    asked_quantity: o.asked_quantity,
    payment_method: o.payment_method,
    status: o.status,
    created_at: o.created_at ?? null,
    updated_at: o.updated_at ?? null,
    bank_id: o.bank_id === undefined ? null : '[redacted]',
    quote_id: o.quote_id === undefined ? null : String(o.quote_id),
    pathpulse_session_id: sessionId,
    pathpulse_settlement_batch_id: batchId,
  };
}

async function main(): Promise<void> {
  const batchId = arg('batch');
  if (!batchId) throw new Error('--batch <settlementBatchId> is required');
  const liveOrderId = arg('order');

  await migrate();

  const batch = await getSettlementBatch(batchId);
  console.log('\n── settlement batch the withdrawal draws from ──');
  console.log({
    id: batch.id,
    txHash: batch.txHash,
    grossAmount: batch.grossAmount,
    asset: batch.asset.code,
    network: batch.network,
  });

  let order: CarretOrder;
  if (liveOrderId) {
    const orders = await listOfframpOrders();
    const found = orders.find((o) => String(o.id) === String(liveOrderId));
    if (!found) throw new Error(`Carret order ${liveOrderId} not found on account ${env.carret.accountId}`);
    order = found;
    console.log(`\nmode: LIVE — Carret order ${liveOrderId} read from ${env.carret.baseUrl}`);
  } else {
    const placedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    order = {
      id: `demo-${randomBytes(3).toString('hex')}`,
      status: 'filled',
      asked_quantity: '10',
      payment_method: 'bank_transfer',
      created_at: placedAt,
      updated_at: new Date().toISOString(),
    };
    console.log('\nmode: OFFLINE — Carret order list supplied as a fixture, nothing placed');
  }

  const createdAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const sessionId = `ofr_demo_${Date.now()}_${randomBytes(4).toString('hex')}`;

  await saveSession({
    id: sessionId,
    ppUserId: `demo_${randomBytes(3).toString('hex')}`,
    provider: 'carret',
    sandbox: !liveOrderId,
    status: 'pending_anchor',
    interactiveUrl: `${env.webAppUrl}/dashboard/offramp?session=${sessionId}`,
    amount: order.asked_quantity,
    asset: { code: env.carret.crypto },
    fiatCurrency: env.carret.fiat,
    settlementBatchId: batchId,
    carretOrderId: String(order.id),
    createdAt,
    updatedAt: createdAt,
  });

  console.log('\n── 1. session persisted, webhook deliberately never delivered ──');
  console.log({
    sessionId,
    status: 'pending_anchor',
    carretOrderId: String(order.id),
    settlementBatchId: batchId,
  });
  console.log(`Carret says this order is "${order.status}". PathPulse still believes it is pending.`);

  const deps: ReconcileDeps = { listOrders: async () => [order] };
  const report = await reconcileOnce(deps);
  const outcome = report.outcomes.find((o) => o.sessionId === sessionId);

  console.log('\n── 2. reconciler pass ──');
  console.log({ scanned: report.scanned, recovered: report.recovered, unmatched: report.unmatched, failed: report.failed });
  console.log(outcome);

  const recovered = await getSession(sessionId);
  console.log('\n── 3. session after recovery ──');
  console.log({
    sessionId: recovered?.id,
    status: recovered?.status,
    carretOrderId: recovered?.carretOrderId,
    settlementBatchId: recovered?.settlementBatchId,
    updatedAt: recovered?.updatedAt,
  });

  console.log('\n── 4. persisted status event timeline ──');
  for (const e of await listEvents(sessionId)) {
    console.log(`${e.createdAt}  ${e.previousStatus ?? '(none)'} → ${e.status}  [${e.source}]`);
  }

  console.log('\n── 5. redacted Carret order record ──');
  console.log(JSON.stringify(redactOrder(order, sessionId, batchId), null, 2));

  if (recovered?.status !== 'completed') {
    throw new Error(`recovery did not converge: session is ${recovered?.status}`);
  }
  if (recovered.settlementBatchId !== batchId) {
    throw new Error('recovered session lost its settlement batch link');
  }
  console.log('\nOK — recovered by the reconciler, still linked to its settlement batch.');

  if (!flag('keep')) {
    await db().query('delete from off_ramp_status_events where session_id = $1', [sessionId]);
    await db().query('delete from off_ramp_sessions where id = $1', [sessionId]);
    console.log('demo rows removed (pass --keep to leave them in place)');
  }
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
