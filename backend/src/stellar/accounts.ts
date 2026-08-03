import {
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Signer as SignerOp,
} from '@stellar/stellar-sdk';
import type {
  DistributionAccount,
  DistributionAccountRole,
  TreasuryConfig,
} from '@pathpulse/contract';
import { env } from '../config/env.js';
import { horizon, accountExists } from './network.js';

const ROLE_TO_PUBLIC: Record<DistributionAccountRole, string> = {
  partner_revenue: env.distribution.partnerRevenue,
  driver_pool: env.distribution.driverPool,
  treasury: env.distribution.treasury,
};

/** On-chain: does this account have a multisig signer set */
async function hasMultisig(publicKey: string): Promise<boolean> {
  if (!publicKey || !(await accountExists(publicKey))) return false;
  const acct = await horizon.loadAccount(publicKey);
  return acct.signers.length > 1;
}

export async function listDistributionAccounts(): Promise<DistributionAccount[]> {
  const roles = Object.keys(ROLE_TO_PUBLIC) as DistributionAccountRole[];
  return Promise.all(
    roles.map(async (role) => {
      const publicKey = ROLE_TO_PUBLIC[role];
      return {
        role,
        publicKey,
        multisig: role === 'treasury' ? await hasMultisig(publicKey) : false,
        network: env.network,
      };
    }),
  );
}

export async function getTreasuryConfig(): Promise<TreasuryConfig> {
  const publicKey = env.distribution.treasury;
  let signers = env.treasury.signers.map((pk) => ({ publicKey: pk, weight: 1 }));
  if (publicKey && (await accountExists(publicKey))) {
    const acct = await horizon.loadAccount(publicKey);
    signers = acct.signers.map((s) => ({ publicKey: s.key, weight: s.weight }));
  }
  return {
    publicKey,
    signers,
    thresholds: env.treasury.thresholds,
    network: env.network,
  };
}

/**
 * Build the multisig-configuration transaction for the treasury account
 * (add signers, set thresholds ≥ 2/3). This BUILDS the transaction only —
 * it is human-gated: a signatory reviews and signs/submits it. We never
 * auto-provision the treasury signer set.
 *
 * Returns base64 XDR for review.
 */

export async function buildTreasuryMultisigTx(): Promise<{ xdr: string }> {
  const publicKey = env.distribution.treasury;
  if (!publicKey) throw new Error('TREASURY_PUBLIC not configured');
  const signers = env.treasury.signers;
  if (signers.length < 3) {
    throw new Error('Treasury multisig requires at least 3 signer public keys (2/3 threshold)');
  }

  const account = await horizon.loadAccount(publicKey);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  });

  for (const signerKey of signers) {
    if (signerKey === publicKey) continue;
    builder.addOperation(
      Operation.setOptions({
        signer: { ed25519PublicKey: signerKey, weight: 1 } as SignerOp,
      }),
    );
  }

  builder.addOperation(
    Operation.setOptions({
      masterWeight: 1,
      lowThreshold: env.treasury.thresholds.low,
      medThreshold: env.treasury.thresholds.medium,
      highThreshold: env.treasury.thresholds.high,
    }),
  );

  const tx = builder.setTimeout(300).build();
  return { xdr: tx.toXDR() };
}
