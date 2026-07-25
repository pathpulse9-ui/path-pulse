import { Keypair, Transaction } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';

/**
 * Signer abstraction. Phase 1 ships the `dev` backend (in-process keypairs on
 * testnet). Phases 5–6 swap in aws-kms / gcp-kms / hsm implementations behind
 * this same interface — the calling code never changes.
 *
 * HARD RULE: no signer will produce a mainnet signature without an explicit,
 * human-gated backend (KMS/HSM). The dev signer refuses mainnet outright.
 */
export interface Signer {
  /** Public key this signer can sign for. */
  readonly publicKey: string;
  sign(tx: Transaction): Promise<Transaction>;
}

/** Dev-tier signer: holds a testnet secret key in memory. NEVER for mainnet. */
export class DevSigner implements Signer {
  private readonly keypair: Keypair;
  readonly publicKey: string;

  constructor(secretKey: string) {
    if (env.network === 'mainnet') {
      throw new Error(
        'DevSigner is prohibited on mainnet — configure a KMS/HSM signer backend (human-gated).',
      );
    }
    this.keypair = Keypair.fromSecret(secretKey);
    this.publicKey = this.keypair.publicKey();
  }

  async sign(tx: Transaction): Promise<Transaction> {
    tx.sign(this.keypair);
    return tx;
  }
}

/** Factory selecting the signer implementation from SIGNER_BACKEND. */
export function createSigner(secretKeyForDev?: string): Signer {
  switch (env.signerBackend) {
    case 'dev':
      if (!secretKeyForDev) {
        throw new Error('dev signer requires a testnet secret key');
      }
      return new DevSigner(secretKeyForDev);
    case 'aws-kms':
    case 'gcp-kms':
    case 'hsm':
      throw new Error(
        `Signer backend "${env.signerBackend}" is not yet implemented (Phase 5, human-gated).`,
      );
    default:
      throw new Error(`Unknown SIGNER_BACKEND: ${env.signerBackend}`);
  }
}
