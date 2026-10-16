import PDFDocument from 'pdfkit';
import type { SettlementBatch } from '@pathpulse/contract';

const CSV_HEADERS = [
  'batch_id',
  'created_at',
  'network',
  'asset_code',
  'gross_amount',
  'authorities_amount',
  'driver_rewards_amount',
  'treasury_amount',
  'driver_payouts_count',
  'tx_hash',
  'horizon_url',
  'payout_batch_id',
  'deposit_tx_hash',
  'deposit_from',
  'deposit_amount',
] as const;

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const s = /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function batchesToCsv(batches: SettlementBatch[]): string {
  const rows = [CSV_HEADERS.join(',')];
  for (const b of batches) {
    rows.push(
      [
        b.id,
        b.createdAt,
        b.network,
        b.asset.code,
        b.grossAmount,
        b.split.authorities,
        b.split.driverRewards,
        b.split.treasury,
        (b.driverPayouts ?? []).length,
        b.txHash,
        b.horizonUrl ?? '',
        b.payoutBatchId ?? '',
        b.deposit?.txHash ?? '',
        b.deposit?.from ?? '',
        b.deposit?.amount ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return rows.join('\n') + '\n';
}

export async function batchReceiptPdf(batch: SettlementBatch): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc
      .font('Helvetica-Bold').fontSize(20).fillColor('#000000')
      .text('PathPulse — Settlement Receipt', { align: 'left' })
      .moveDown(0.3);
    doc
      .font('Helvetica').fontSize(10).fillColor('#666666')
      .text(`Generated ${new Date().toISOString()}`)
      .moveDown(1.2);

    kv(doc, 'Batch ID',       batch.id, true);
    kv(doc, 'Created at',     batch.createdAt);
    kv(doc, 'Network',        batch.network);
    kv(doc, 'Transaction',    batch.txHash, true);
    if (batch.horizonUrl) kv(doc, 'Horizon URL',    batch.horizonUrl);
    if (batch.payoutBatchId) kv(doc, 'Payout batch id', batch.payoutBatchId, true);
    if (batch.deposit) {
      kv(doc, 'Funded by deposit', batch.deposit.txHash, true);
      kv(doc, 'Deposit', `${batch.deposit.amount} ${batch.asset.code} from ${batch.deposit.from}`);
    }
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text('Deterministic split', 54).moveDown(0.4);
    const gross = batch.grossAmount;
    const asset = batch.asset.code;
    splitRow(doc, 'Authorities (50%)',    `${batch.split.authorities} ${asset}`);
    splitRow(doc, 'Driver rewards (30%)', `${batch.split.driverRewards} ${asset}`);
    splitRow(doc, 'Treasury (20%)',       `${batch.split.treasury} ${asset}`);
    doc.moveDown(0.3);
    splitRow(doc, 'Gross',                `${gross} ${asset}`, true);
    doc.moveDown(1);

    if ((batch.driverPayouts ?? []).length) {
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text('Driver payouts', 54).moveDown(0.4);
      const cols = { userId: 54, address: 200, tier: 380, mult: 430, amount: 490 };
      const headerY = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
      doc.text('User',      cols.userId,  headerY);
      doc.text('Address',   cols.address, headerY);
      doc.text('Tier',      cols.tier,    headerY);
      doc.text('×',         cols.mult,    headerY);
      doc.text('Amount',    cols.amount,  headerY, { width: 80, align: 'right' });
      doc.moveDown(0.8);
      doc.moveTo(54, doc.y).lineTo(558, doc.y).lineWidth(0.5).strokeColor('#DDDDDD').stroke();
      doc.moveDown(0.4);

      doc.font('Helvetica').fontSize(9).fillColor('#000000');
      for (const p of batch.driverPayouts) {
        const y = doc.y;
        doc.font('Helvetica').text(truncate(p.userId, 26), cols.userId, y, { width: cols.address - cols.userId - 8 });
        doc.font('Courier').text(short(p.address),         cols.address, y, { width: cols.tier - cols.address - 8 });
        doc.font('Helvetica').text(`SCOUT${p.tier}`,       cols.tier,    y, { width: cols.mult - cols.tier - 4 });
        doc.text(p.multiplier.toFixed(1),                  cols.mult,    y, { width: cols.amount - cols.mult - 4 });
        doc.text(`${p.amount} ${asset}`,                   cols.amount,  y, { width: 80, align: 'right' });
        doc.moveDown(0.8);
      }
      doc.moveDown(0.6);
    }

    doc.moveTo(54, doc.y).lineTo(558, doc.y).lineWidth(0.5).strokeColor('#DDDDDD').stroke();
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(9).fillColor('#666666').text(
      'This receipt is generated from PathPulse’s on-chain settlement indexer. ' +
      'Every amount above is enforced by the Stellar transaction referenced above ' +
      'and can be independently verified on Horizon or stellar.expert.',
      54, doc.y, { width: 504 },
    );
    doc.moveDown(1.2);
    doc.text('Signed by: __________________________     Date: _______________', 54, doc.y);

    doc.end();
  });
}

function kv(doc: PDFKit.PDFDocument, label: string, value: string, mono = false): void {
  const y = doc.y;
  doc.font('Helvetica').fontSize(10).fillColor('#666666').text(label, 54, y, { width: 130 });
  doc.font(mono ? 'Courier' : 'Helvetica').fillColor('#000000').text(value, 190, y, { width: 368 });
  doc.moveDown(0.2);
}

function splitRow(doc: PDFKit.PDFDocument, label: string, value: string, bold = false): void {
  const y = doc.y;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor('#000000');
  doc.text(label, 54,  y, { width: 260 });
  doc.text(value, 314, y, { width: 244, align: 'right' });
  doc.moveDown(0.4);
}

function short(a: string): string {
  return a.length <= 14 ? a : `${a.slice(0, 6)}…${a.slice(-6)}`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

const PAYOUT_CSV_HEADERS = [
  'batch_id',
  'batch_created_at',
  'network',
  'asset_code',
  'treasury_deposit_tx_hash',
  'settlement_tx_hash',
  'payout_batch_id',
  'user_id',
  'driver_address',
  'scout_tier',
  'multiplier',
  'amount',
] as const;

export function payoutsToCsv(batches: SettlementBatch[]): string {
  const rows: string[] = [PAYOUT_CSV_HEADERS.join(',')];
  for (const b of batches) {
    for (const p of b.driverPayouts ?? []) {
      rows.push(
        [
          b.id,
          b.createdAt,
          b.network,
          b.asset.code,
          b.deposit?.txHash ?? '',
          b.txHash,
          b.payoutBatchId ?? '',
          p.userId,
          p.address,
          p.tier,
          p.multiplier,
          p.amount,
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return rows.join('\n') + '\n';
}
