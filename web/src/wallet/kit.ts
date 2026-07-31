import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FREIGHTER_ID,
  type ISupportedWallet,
} from '@creit.tech/stellar-wallets-kit';
import {
  Horizon,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';

/**
 * PAT-9 / D2 — Stellar Wallets Kit integration.
 *
 * External-wallet interop for operators/partners (Freighter, Lobstr, xBull, Albedo…).
 * This is the client-side signing path — distinct from the driver managed wallets,
 * which the backend delegate-signs. Testnet only.
 */

export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';
export const SESSION_KEY = 'pathpulse.walletSession';

export const horizon = new Horizon.Server(HORIZON_URL);

export interface WalletSession {
  walletId: string;
  walletName: string;
  address: string;
}

export interface AccountState {
  balanceXlm: string;
  sequence: string;
  address: string;
  funded: true;
}

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: allowAllModules(),
});

// ── session persistence (wallet session management) ───────────────────
export function saveSession(s: WalletSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
export function loadSession(): WalletSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as WalletSession) : null;
  } catch {
    return null;
  }
}
export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ── connect / disconnect ──────────────────────────────────────────────
export function openWalletModal(onSelected: (s: WalletSession) => void, onError: (e: string) => void) {
  return kit.openModal({
    modalTitle: 'Connect a Stellar wallet',
    onWalletSelected: async (option: ISupportedWallet) => {
      try {
        kit.setWallet(option.id);
        const { address } = await kit.getAddress();
        const session: WalletSession = { walletId: option.id, walletName: option.name, address };
        saveSession(session);
        onSelected(session);
      } catch (e) {
        onError(String(e));
      }
    },
  });
}

export function restoreWallet(session: WalletSession) {
  kit.setWallet(session.walletId);
}

export async function disconnectWallet() {
  try {
    await kit.disconnect();
  } catch {
    // some wallets don't implement disconnect; clearing the session is what matters
  }
  clearSession();
}

// ── Horizon account state ─────────────────────────────────────────────
export type LoadAccountResult =
  | { status: 'funded'; account: AccountState }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export async function loadAccount(address: string): Promise<LoadAccountResult> {
  try {
    const account = await horizon.loadAccount(address);
    const native = account.balances.find((b) => b.asset_type === 'native');
    return {
      status: 'funded',
      account: {
        balanceXlm: native ? native.balance : '0',
        sequence: account.sequence,
        address,
        funded: true,
      },
    };
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'NotFoundError') return { status: 'not_found' };
    return { status: 'error', message: String(e) };
  }
}

export async function fundWithFriendbot(address: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`Friendbot HTTP ${res.status}`);
}

// ── test transaction: build → external-wallet sign → submit ───────────
export interface SubmitResult {
  hash: string;
  explorerUrl: string;
}

export async function signAndSubmitPayment(
  session: WalletSession,
  destination: string,
  amount = '1',
): Promise<SubmitResult> {
  const source = await horizon.loadAccount(session.address);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({ destination, asset: Asset.native(), amount }),
    )
    .setTimeout(180)
    .build();

  const { signedTxXdr } = await kit.signTransaction(tx.toXDR(), {
    address: session.address,
    networkPassphrase: WalletNetwork.TESTNET,
  });

  const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
  const res = await horizon.submitTransaction(signed);
  return {
    hash: res.hash,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${res.hash}`,
  };
}
