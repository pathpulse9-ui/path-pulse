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

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const SESSION_KEY = 'pathpulse.walletSession';

const server = new Horizon.Server(HORIZON_URL);

interface WalletSession {
  walletId: string;
  walletName: string;
  address: string;
}

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: allowAllModules(),
});

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sessionInfo = el<HTMLDivElement>('session-info');
const accountCard = el<HTMLElement>('account-card');
const accountInfo = el<HTMLDivElement>('account-info');
const txCard = el<HTMLElement>('tx-card');
const txResult = el<HTMLDivElement>('tx-result');
const logEl = el<HTMLPreElement>('log');
const btnConnect = el<HTMLButtonElement>('btn-connect');
const btnDisconnect = el<HTMLButtonElement>('btn-disconnect');
const btnRefresh = el<HTMLButtonElement>('btn-refresh');
const btnFund = el<HTMLButtonElement>('btn-fund');
const btnSend = el<HTMLButtonElement>('btn-send');
const txDest = el<HTMLInputElement>('tx-dest');

let session: WalletSession | null = null;

function log(msg: string, cls: '' | 'ok' | 'err' = '') {
  const line = document.createElement('span');
  line.textContent = `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`;
  if (cls) line.className = cls;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// --- Session management -----------------------------------------------------

function saveSession(s: WalletSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

function loadSession(): WalletSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as WalletSession) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function renderSession() {
  if (session) {
    sessionInfo.innerHTML = `Connected via <strong>${session.walletName}</strong><br/><code>${session.address}</code>`;
    btnConnect.hidden = true;
    btnDisconnect.hidden = false;
    accountCard.hidden = false;
    txCard.hidden = false;
  } else {
    sessionInfo.textContent = 'No wallet connected.';
    btnConnect.hidden = false;
    btnDisconnect.hidden = true;
    accountCard.hidden = true;
    txCard.hidden = true;
    accountInfo.textContent = '—';
    txResult.textContent = '';
  }
}

async function establishSession(walletId: string, walletName: string) {
  kit.setWallet(walletId);
  const { address } = await kit.getAddress();
  session = { walletId, walletName, address };
  saveSession(session);
  renderSession();
  log(`Wallet connected: ${walletName} → ${address}`, 'ok');
  await refreshAccount();
}

// --- Horizon account state ---------------------------------------------------

async function refreshAccount() {
  if (!session) return;
  accountInfo.textContent = 'Loading…';
  try {
    const account = await server.loadAccount(session.address);
    const native = account.balances.find((b) => b.asset_type === 'native');
    accountInfo.innerHTML =
      `Balance: <strong>${native ? native.balance : '0'} XLM</strong> · ` +
      `sequence ${account.sequence} · ` +
      `<a href="${HORIZON_URL}/accounts/${session.address}" target="_blank" rel="noopener">view on Horizon</a>`;
    log(`Account loaded from Horizon (${native?.balance ?? '0'} XLM)`);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'NotFoundError') {
      accountInfo.textContent = 'Account not found on testnet — fund it via Friendbot below.';
      log('Account not found on testnet; needs Friendbot funding', 'err');
    } else {
      accountInfo.textContent = `Horizon error: ${String(e)}`;
      log(`Horizon error: ${String(e)}`, 'err');
    }
  }
}

async function fundWithFriendbot() {
  if (!session) return;
  btnFund.disabled = true;
  log('Requesting Friendbot funding…');
  try {
    const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(session.address)}`);
    if (!res.ok) throw new Error(`Friendbot HTTP ${res.status}`);
    log('Friendbot funded the account', 'ok');
    await refreshAccount();
  } catch (e) {
    log(`Friendbot failed: ${String(e)}`, 'err');
  } finally {
    btnFund.disabled = false;
  }
}

// --- Test transaction ---------------------------------------------------------

async function signAndSubmitPayment() {
  if (!session) return;
  btnSend.disabled = true;
  txResult.textContent = '';
  const destination = txDest.value.trim() || session.address;
  try {
    log(`Building 1 XLM payment → ${destination}`);
    const source = await server.loadAccount(session.address);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' }))
      .setTimeout(180)
      .build();

    log(`Requesting signature from ${session.walletName}…`);
    const { signedTxXdr } = await kit.signTransaction(tx.toXDR(), {
      address: session.address,
      networkPassphrase: WalletNetwork.TESTNET,
    });
    log('Transaction signed by external wallet', 'ok');

    const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
    const res = await server.submitTransaction(signed);
    const link = `https://stellar.expert/explorer/testnet/tx/${res.hash}`;
    txResult.innerHTML = `<span class="ok">✓ Submitted.</span> Hash: <code>${res.hash}</code> · <a href="${link}" target="_blank" rel="noopener">stellar.expert</a>`;
    log(`Submitted to Horizon: ${res.hash}`, 'ok');
    await refreshAccount();
  } catch (e) {
    txResult.innerHTML = `<span class="err">✗ ${String(e)}</span>`;
    log(`Payment failed: ${String(e)}`, 'err');
  } finally {
    btnSend.disabled = false;
  }
}

// --- Wire up -------------------------------------------------------------------

btnConnect.addEventListener('click', async () => {
  await kit.openModal({
    modalTitle: 'Connect a Stellar wallet',
    onWalletSelected: async (option: ISupportedWallet) => {
      try {
        await establishSession(option.id, option.name);
      } catch (e) {
        log(`Connection failed: ${String(e)}`, 'err');
      }
    },
  });
});

btnDisconnect.addEventListener('click', async () => {
  try {
    await kit.disconnect();
  } catch {
    // some wallets don't implement disconnect; session clear is what matters
  }
  session = null;
  clearSession();
  renderSession();
  log('Session cleared');
});

btnRefresh.addEventListener('click', refreshAccount);
btnFund.addEventListener('click', fundWithFriendbot);
btnSend.addEventListener('click', signAndSubmitPayment);

// Restore a persisted session on load (wallet session management)
const restored = loadSession();
if (restored) {
  session = restored;
  kit.setWallet(restored.walletId);
  renderSession();
  log(`Session restored: ${restored.walletName} → ${restored.address}`);
  refreshAccount();
} else {
  renderSession();
  log('Ready. Connect a wallet to begin.');
}
