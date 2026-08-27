import { KMSClient, GetPublicKeyCommand, SignCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { StrKey, type Transaction } from '@stellar/stellar-sdk';
import type { Signer } from './signing.js';

const SPKI_ED25519_LENGTH = 44;
const RAW_KEY_LENGTH = 32;

export interface KmsSignClient {
  getPublicKey(keyId: string): Promise<Uint8Array>;
  sign(keyId: string, message: Buffer): Promise<Uint8Array>;
}

export interface KmsDecryptClient {
  decrypt(ciphertext: Buffer): Promise<Uint8Array>;
}

export function addressFromSpki(der: Uint8Array): string {
  const buf = Buffer.from(der);
  if (buf.length !== SPKI_ED25519_LENGTH) {
    throw new Error(
      `Expected a ${SPKI_ED25519_LENGTH}-byte Ed25519 SPKI key, got ${buf.length} — is the KMS key ECC_NIST_EDWARDS25519?`,
    );
  }
  return StrKey.encodeEd25519PublicKey(buf.subarray(buf.length - RAW_KEY_LENGTH));
}

export function awsKmsDecryptClient(): KmsDecryptClient {
  const client = new KMSClient({});
  return {
    async decrypt(ciphertext) {
      const r = await client.send(new DecryptCommand({ CiphertextBlob: ciphertext }));
      if (!r.Plaintext) throw new Error('KMS Decrypt returned no plaintext');
      return r.Plaintext;
    },
  };
}

export function awsKmsClient(): KmsSignClient {
  const client = new KMSClient({});
  return {
    async getPublicKey(keyId) {
      const r = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
      if (!r.PublicKey) throw new Error(`KMS GetPublicKey returned no key for ${keyId}`);
      return r.PublicKey;
    },
    async sign(keyId, message) {
      const r = await client.send(
        new SignCommand({
          KeyId: keyId,
          Message: message,
          MessageType: 'RAW',
          SigningAlgorithm: 'ED25519_SHA_512',
        }),
      );
      if (!r.Signature) throw new Error(`KMS Sign returned no signature for ${keyId}`);
      return r.Signature;
    },
  };
}

/** Signs Stellar transactions with an Ed25519 key held in KMS. The seed never leaves KMS. */
export class AwsKmsSigner implements Signer {
  readonly publicKey: string;
  private readonly keyId: string;
  private readonly kms: KmsSignClient;

  private constructor(keyId: string, kms: KmsSignClient, publicKey: string) {
    this.keyId = keyId;
    this.kms = kms;
    this.publicKey = publicKey;
  }

  static async create(keyId: string, kms: KmsSignClient = awsKmsClient()): Promise<AwsKmsSigner> {
    if (!keyId) throw new Error('KMS_KEY_ID is not set — the aws-kms signer needs a key id or ARN');
    return new AwsKmsSigner(keyId, kms, addressFromSpki(await kms.getPublicKey(keyId)));
  }

  async sign(tx: Transaction): Promise<Transaction> {
    const signature = await this.kms.sign(this.keyId, tx.hash());
    tx.addSignature(this.publicKey, Buffer.from(signature).toString('base64'));
    return tx;
  }
}
