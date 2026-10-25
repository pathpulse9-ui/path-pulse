import {
  Asset,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  type Account,
  type FeeBumpTransaction,
  type Transaction,
} from '@stellar/stellar-sdk';
import { env } from '../config/env.js';
import { horizon, submitToHorizon } from './network.js';
import type { Signer } from './signing.js';
import { sendAlertInBackground } from '../services/alerts.js';

export interface ReserveSponsor {
  address: string;
  signer: Signer;
}

const HOUR_MS = 60 * 60 * 1000;
const spend = { account: [] as number[], feeBump: [] as number[] };

function budgetError(message: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = 'SponsorBudgetExhausted';
  e.status = 503;
  return e;
}

export function chargeSponsor(kind: 'account' | 'feeBump', now = Date.now()): void {
  const limit = kind === 'account' ? env.sponsor.maxAccountsPerHour : env.sponsor.maxFeeBumpsPerHour;
  const window = spend[kind].filter((t) => now - t < HOUR_MS);
  spend[kind] = window;
  if (window.length >= limit) {
    sendAlertInBackground({
      key: `sponsor-budget:${kind}`,
      severity: 'critical',
      title: `Reserve sponsor ${kind} budget exhausted (${limit}/hour)`,
    });
    throw budgetError('Sponsored operations are temporarily paused — try again later');
  }
  window.push(now);
}

export function assertSponsorFunded(sponsor: Account & { balances?: Array<{ asset_type: string; balance: string }> }): void {
  const native = sponsor.balances?.find((b) => b.asset_type === 'native');
  if (!native) return;
  if (Number(native.balance) < env.sponsor.minBalanceXlm) {
    sendAlertInBackground({
      key: 'sponsor-balance',
      severity: 'critical',
      title: `Reserve sponsor below ${env.sponsor.minBalanceXlm} XLM`,
      detail: `balance ${native.balance} XLM`,
    });
    throw budgetError('Sponsored operations are paused until the reserve sponsor is topped up');
  }
}

export function _resetSponsorBudgetForTests(): void {
  spend.account = [];
  spend.feeBump = [];
}

export function buildSponsoredAccountTx(sponsor: Account, newAccount: string, trustlines: Asset[]): Transaction {
  const builder = new TransactionBuilder(sponsor, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: newAccount }))
    .addOperation(Operation.createAccount({ destination: newAccount, startingBalance: '0' }));
  for (const asset of trustlines) builder.addOperation(Operation.changeTrust({ asset, source: newAccount }));
  return builder
    .addOperation(Operation.endSponsoringFutureReserves({ source: newAccount }))
    .setTimeout(120)
    .build();
}

export function buildSponsoredTrustlineTx(sponsor: Account, holder: string, asset: Asset): Transaction {
  return new TransactionBuilder(sponsor, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: holder }))
    .addOperation(Operation.changeTrust({ asset, source: holder }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: holder }))
    .setTimeout(120)
    .build();
}

async function signBoth(tx: Transaction, sponsor: ReserveSponsor, holder: Signer): Promise<Transaction> {
  return holder.sign(await sponsor.signer.sign(tx));
}

export async function createSponsoredAccount(sponsor: ReserveSponsor, holder: Signer, trustlines: Asset[]) {
  const source = await horizon.loadAccount(sponsor.address);
  assertSponsorFunded(source);
  chargeSponsor('account');
  const tx = buildSponsoredAccountTx(source, holder.publicKey, trustlines);
  return submitToHorizon(await signBoth(tx, sponsor, holder), 'sponsored account creation');
}

export async function addSponsoredTrustline(sponsor: ReserveSponsor, holder: Signer, asset: Asset) {
  const source = await horizon.loadAccount(sponsor.address);
  assertSponsorFunded(source);
  chargeSponsor('feeBump');
  const tx = buildSponsoredTrustlineTx(source, holder.publicKey, asset);
  return submitToHorizon(await signBoth(tx, sponsor, holder), 'sponsored trustline');
}

export function buildSponsoredFeeBump(sponsor: string, inner: Transaction): FeeBumpTransaction {
  return TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, inner, env.networkPassphrase);
}

export async function sponsorFees(sponsor: ReserveSponsor, inner: Transaction): Promise<FeeBumpTransaction> {
  chargeSponsor('feeBump');
  return sponsor.signer.sign(buildSponsoredFeeBump(sponsor.address, inner));
}
