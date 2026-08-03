import { StellarWalletsKit, Networks } from '@creit.tech/stellar-wallets-kit';
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';
import { Horizon } from '@stellar/stellar-sdk';

export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';

export const server = new Horizon.Server(HORIZON_URL);

let initialized = false;

export function initKit() {
  if (initialized) return;
  StellarWalletsKit.init({
    network: Networks.TESTNET,
    modules: [new FreighterModule(), new xBullModule(), new AlbedoModule(), new LobstrModule()],
  });
  initialized = true;
}

export { StellarWalletsKit };
