import { Keypair, type FeeBumpTransaction, type Transaction } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';

export interface Signer {
  readonly publicKey: string;
  sign<T extends Transaction | FeeBumpTransaction>(tx: T): Promise<T>;
}

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

  async sign<T extends Transaction | FeeBumpTransaction>(tx: T): Promise<T> {
    tx.sign(this.keypair);
    return tx;
  }
}

export class CustodialSigner implements Signer {
  private readonly keypair: Keypair;
  readonly publicKey: string;

  constructor(keypair: Keypair) {
    this.keypair = keypair;
    this.publicKey = keypair.publicKey();
  }

  async sign<T extends Transaction | FeeBumpTransaction>(tx: T): Promise<T> {
    tx.sign(this.keypair);
    return tx;
  }
}

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
