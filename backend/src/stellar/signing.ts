import { Keypair, Transaction } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';

/**
 * Signer abstraction. `dev` and `aws-kms` are implemented; gcp-kms and hsm are declared
 * and throw. The live signer is `dev` in every environment — aws-kms is verified on testnet
 * but not yet in service. See docs/KMS_VERIFICATION.md.
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
        'DevSigner is prohibited on mainnet — configure a KMS/HSM signer backend (human-gated).',
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
    case 'gcp-kms':
    case 'hsm':
      throw new Error(
        `Signer backend "${env.signerBackend}" is not yet implemented (Phase 5, human-gated).`,
      );
  }
}
