import { Keypair, Transaction } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';

/**
 * Signer abstraction. Two backends: `dev` (in-memory keypair, testnet only) and `aws-kms`
 * (Ed25519 key held in AWS KMS, never in this process). See docs/KMS_VERIFICATION.md.
 *
 * HARD RULE: no signer will produce a mainnet signature without an explicit,
 * human-gated backend. The dev signer refuses mainnet outright.
 */
export interface Signer {
  /** Public key this signer can sign for. */
  readonly publicKey: string;
  sign(tx: Transaction): Promise<Transaction>;
}

/** Dev-tier signer: holds a testnet keypair in memory. NEVER for mainnet. */
export class DevSigner implements Signer {
  private readonly keypair: Keypair;
  readonly publicKey: string;

  constructor(keypair: Keypair) {
    if (env.network === 'mainnet') {
      throw new Error(
        'DevSigner is prohibited on mainnet — set SIGNER_BACKEND=aws-kms (human-gated).',
      );
    }
    this.keypair = keypair;
    this.publicKey = keypair.publicKey();
  }

  async sign(tx: Transaction): Promise<Transaction> {
    tx.sign(this.keypair);
    return tx;
  }
}

/** Factory selecting the signer implementation from SIGNER_BACKEND. */
export async function createSigner(keypair?: Keypair): Promise<Signer> {
  switch (env.signerBackend) {
    case 'dev':
      if (!keypair) {
        throw new Error('dev signer requires a keypair');
      }
      return new DevSigner(keypair);
    case 'aws-kms': {
      const { AwsKmsSigner } = await import('./kms.js');
      return AwsKmsSigner.create(env.kms.keyId);
    }
  }
}
