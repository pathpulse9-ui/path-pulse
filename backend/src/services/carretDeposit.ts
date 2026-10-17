import { Asset, BASE_FEE, Memo, Operation, TransactionBuilder, type Account, type Transaction } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';
import { horizon, submitToHorizon } from '../stellar/network.js';
import { getManagedSigner, getManagedWallet, getReserveSponsor } from '../stellar/managed.js';
import { sponsorFees } from '../stellar/sponsorship.js';
import { toStroops } from '../stellar/settlement.js';
import { logUpstream } from '../util/upstreamLog.js';

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

export function carretDepositAsset(): Asset {
  const ref = env.driverTrustlines.find((a) => a.code.toUpperCase() === env.carret.crypto.toUpperCase());
  if (!ref?.issuer) {
    throw httpError(`No issuer configured for ${env.carret.crypto} in DRIVER_TRUSTLINES`, 500, 'ConfigError');
  }
  return new Asset(ref.code, ref.issuer);
}

function depositMemo(label: string | null): Memo {
  if (!label) throw httpError('Carret returned no deposit memo — refusing to send an unattributable deposit', 502, 'CarretDepositUnavailable');
  return /^\d+$/.test(label) ? Memo.id(label) : Memo.text(label);
}

export function buildCarretDepositTx(
  source: Account,
  destination: string,
  memoLabel: string | null,
  asset: Asset,
  amount: string,
): Transaction {
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(Operation.payment({ destination, asset, amount }))
    .addMemo(depositMemo(memoLabel))
    .setTimeout(120)
    .build();
}

export async function assertCanDeposit(userId: string, amount: string): Promise<string> {
  const wallet = await getManagedWallet(userId);
  if (!wallet?.provisioned) {
    throw httpError('Withdrawals need a PathPulse wallet — sign in with Google first', 422, 'NoManagedWallet');
  }
  const asset = carretDepositAsset();
  const account = await horizon.loadAccount(wallet.address);
  const line = account.balances.find(
    (b) => 'asset_code' in b && b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
  );
  const held = line ? toStroops(line.balance) : 0n;
  if (held < toStroops(amount)) {
    throw httpError(
      `Your wallet holds ${line?.balance ?? '0'} ${asset.getCode()}, less than the ${amount} requested`,
      422,
      'InsufficientBalance',
    );
  }
  return wallet.address;
}

export async function sendCarretDeposit(
  userId: string,
  destination: string,
  memoLabel: string | null,
  amount: string,
): Promise<string> {
  const address = await assertCanDeposit(userId, amount);
  const tx = buildCarretDepositTx(await horizon.loadAccount(address), destination, memoLabel, carretDepositAsset(), amount);
  const signed = await (await getManagedSigner(userId)).sign(tx);
  const envelope = env.accountFunding === 'sponsor' ? await sponsorFees(await getReserveSponsor(), signed) : signed;
  try {
    const res = await submitToHorizon(envelope, 'carret deposit');
    return res.hash;
  } catch (e) {
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response?.data?.extras?.result_codes;
    if (!codes) logUpstream('carret deposit failed', e);
    throw httpError(
      codes ? `Deposit to Carret rejected by Horizon: ${JSON.stringify(codes)}` : 'Deposit to Carret failed',
      422,
      'HorizonRejected',
    );
  }
}
