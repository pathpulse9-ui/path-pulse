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

export interface ReserveSponsor {
  address: string;
  signer: Signer;
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
  const tx = buildSponsoredAccountTx(await horizon.loadAccount(sponsor.address), holder.publicKey, trustlines);
  return submitToHorizon(await signBoth(tx, sponsor, holder), 'sponsored account creation');
}

export async function addSponsoredTrustline(sponsor: ReserveSponsor, holder: Signer, asset: Asset) {
  const tx = buildSponsoredTrustlineTx(await horizon.loadAccount(sponsor.address), holder.publicKey, asset);
  return submitToHorizon(await signBoth(tx, sponsor, holder), 'sponsored trustline');
}

export function buildSponsoredFeeBump(sponsor: string, inner: Transaction): FeeBumpTransaction {
  return TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, inner, env.networkPassphrase);
}

export async function sponsorFees(sponsor: ReserveSponsor, inner: Transaction): Promise<FeeBumpTransaction> {
  return sponsor.signer.sign(buildSponsoredFeeBump(sponsor.address, inner));
}
