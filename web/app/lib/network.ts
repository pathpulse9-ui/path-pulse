export type StellarNetwork = 'testnet' | 'mainnet';

export const STELLAR_NETWORK: StellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

export const NETWORK_PASSPHRASE =
  STELLAR_NETWORK === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';

export const HORIZON_URL =
  STELLAR_NETWORK === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';

const EXPLORER = `https://stellar.expert/explorer/${STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet'}`;

export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAcct = (address: string) => `${EXPLORER}/account/${address}`;
