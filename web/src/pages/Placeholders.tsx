import { EmptyState } from '../ui/components';

/** Phase surfaces that land in later tickets. Each is routed now so the shell
 *  structure (and auth gate) is complete from Phase 1. */

export function Payouts() {
  return (
    <Placeholder
      title="Payouts — SDP batches"
      phase="Phase 2 · PAT-8"
      body="Batch payout views and reconciliation once the Stellar Disbursement Platform integration lands."
    />
  );
}

export function OffRamp() {
  return (
    <Placeholder
      title="Off-ramp Reconciliation"
      phase="Phase 3 · PAT-11 / PAT-12"
      body="Mercuryo SEP-24 off-ramp events linked to settlement batch IDs; Stellar Broker routing recon."
    />
  );
}

export function Settlement() {
  return (
    <Placeholder
      title="Settlement Explorer"
      phase="Phase 4 · PAT-13"
      body="Batch drill-down: Treasury → 50/30/20 Split → SDP → Driver. Foundation for the government dashboard."
    />
  );
}

export function GovGateway() {
  return (
    <Placeholder
      title="Government Settlement Gateway"
      phase="Phase 6 · PAT-16"
      body="Institutional transparency: end-to-end traceability, on-chain audit trail, compliance exports (CSV/PDF)."
    />
  );
}

function Placeholder({ title, phase, body }: { title: string; phase: string; body: string }) {
  return (
    <div>
      <h1 className="pp-page__title">{title}</h1>
      <EmptyState title="Lands in a later phase" phase={phase}>
        {body}
      </EmptyState>
    </div>
  );
}
