import { Asset, BASE_FEE, Operation, TransactionBuilder, type Account } from '@stellar/stellar-sdk';
import type {
  AssetRef,
  RoutingQuote,
  TreasuryConversion,
  TreasuryConversionTx,
  TreasuryRoutingPlan,
} from '@pathpulse/contract';
import { env } from '../config/env.js';
import { fromStroops, toStroops } from '../stellar/settlement.js';
import { horizon, accountExists } from '../stellar/network.js';
import { isRoutableSymbol, resolveAsset } from './assets.js';
import { quoteSwap } from './aggregator.js';
import { routingError } from './provider.js';

export interface HeldBalance {
  asset: AssetRef;
  balance: string;
}

type QuoteToSettlement = (fromCode: string, amount: string) => Promise<RoutingQuote>;

function sameAsset(a: AssetRef, b: AssetRef): boolean {
  return a.code.toUpperCase() === b.code.toUpperCase() && (a.issuer ?? '') === (b.issuer ?? '');
}

export async function planConversions(
  balances: HeldBalance[],
  settlementAsset: AssetRef,
  quote: QuoteToSettlement,
): Promise<Omit<TreasuryRoutingPlan, 'treasury' | 'network' | 'settlementAsset'>> {
  let heldSettlementAsset = '0';
  const conversions: TreasuryConversion[] = [];

  for (const b of balances) {
    if (sameAsset(b.asset, settlementAsset)) {
      heldSettlementAsset = b.balance;
      continue;
    }
    if (!b.asset.issuer) continue;
    if (Number(b.balance) <= 0) continue;

    const knownCode = isRoutableSymbol(b.asset.code);
    const routable = knownCode && sameAsset(resolveAsset(b.asset.code).ref, b.asset);
    if (!routable) {
      let reason: string;
      if (b.asset.code.toUpperCase() === settlementAsset.code.toUpperCase()) {
        reason = `held ${b.asset.code} (${b.asset.issuer}) is a different asset from the settlement ${settlementAsset.code} (${settlementAsset.issuer})`;
      } else if (knownCode) {
        reason = `held ${b.asset.code} issuer is not the configured routable issuer`;
      } else {
        reason = `${b.asset.code} is not in ROUTING_ASSETS`;
      }
      conversions.push({ from: b.asset, amount: b.balance, routable: false, reason });
      continue;
    }

    try {
      const q = await quote(b.asset.code, b.balance);
      conversions.push({
        from: b.asset,
        amount: b.balance,
        routable: true,
        quote: {
          provider: q.provider,
          destinationAmount: q.destinationAmount,
          minDestinationAmount: q.minDestinationAmount,
        },
      });
    } catch (e) {
      conversions.push({
        from: b.asset,
        amount: b.balance,
        routable: false,
        reason: (e as Error).message,
      });
    }
  }

  const projected = conversions.reduce(
    (sum, c) => sum + Number(c.quote?.minDestinationAmount ?? 0),
    Number(heldSettlementAsset),
  );

  return {
    balances,
    heldSettlementAsset,
    conversions,
    projectedSettlementAsset: projected.toFixed(7),
  };
}

function readBalances(
  lines: { asset_type: string; balance: string; asset_code?: string; asset_issuer?: string }[],
): HeldBalance[] {
  return lines
    .filter((b) => b.asset_type !== 'liquidity_pool_shares')
    .map((b) =>
      b.asset_type === 'native' || !b.asset_code
        ? { asset: { code: 'XLM' }, balance: b.balance }
        : { asset: { code: b.asset_code, issuer: b.asset_issuer }, balance: b.balance },
    );
}

export async function getTreasuryRoutingPlan(): Promise<TreasuryRoutingPlan> {
  const treasury = env.distribution.treasury;
  if (!treasury) throw routingError('TREASURY_PUBLIC is not configured', 500, 'ConfigError');

  const settlementCode = env.routing.settlementAssetCode;
  if (!isRoutableSymbol(settlementCode)) {
    throw routingError(`Settlement asset ${settlementCode} is not in ROUTING_ASSETS`, 500, 'ConfigError');
  }
  const settlementAsset = resolveAsset(settlementCode).ref;

  if (!(await accountExists(treasury))) {
    throw routingError(`Treasury ${treasury} does not exist on ${env.network}`, 404, 'NotFound');
  }
  const acct = await horizon.loadAccount(treasury);
  const balances = readBalances(acct.balances);

  const plan = await planConversions(balances, settlementAsset, (code, amount) =>
    quoteSwap(code, settlementCode, amount),
  );

  return { treasury, network: env.network, settlementAsset, ...plan };
}

const CONVERSION_TTL_SECONDS = 3600;

export interface StrictSendPath {
  destination_amount: string;
  path: { asset_type: string; asset_code?: string; asset_issuer?: string }[];
}

function toAsset(ref: AssetRef): Asset {
  return ref.issuer ? new Asset(ref.code, ref.issuer) : Asset.native();
}

function pathRef(p: StrictSendPath['path'][number]): AssetRef {
  return p.asset_type === 'native' || !p.asset_code ? { code: 'XLM' } : { code: p.asset_code, issuer: p.asset_issuer };
}

export function bestStrictSendPath(records: StrictSendPath[]): StrictSendPath {
  const usable = records.filter((r) => toStroops(Number(r.destination_amount).toFixed(7)) > 0n);
  if (!usable.length) throw routingError('No path on the Stellar DEX for this conversion', 422, 'NoRoute');
  return usable.reduce((best, r) => (Number(r.destination_amount) > Number(best.destination_amount) ? r : best));
}

export function buildConversionTx(
  treasury: Account,
  from: AssetRef,
  to: AssetRef,
  sendAmount: string,
  route: StrictSendPath,
  slippageBps: number,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const estimated = toStroops(Number(route.destination_amount).toFixed(7));
  const minOut = (estimated * BigInt(10_000 - slippageBps)) / 10_000n;
  const tx = new TransactionBuilder(treasury, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
    timebounds: { minTime: 0, maxTime: nowSeconds + CONVERSION_TTL_SECONDS },
  })
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: toAsset(from),
        sendAmount,
        destination: treasury.accountId(),
        destAsset: toAsset(to),
        destMin: fromStroops(minOut),
        path: route.path.map((p) => toAsset(pathRef(p))),
      }),
    )
    .build();
  return { tx, estimated, minOut, expiresAt: new Date((nowSeconds + CONVERSION_TTL_SECONDS) * 1000).toISOString() };
}

export async function buildTreasuryConversion(fromCode: string, amount: string): Promise<TreasuryConversionTx> {
  const treasuryId = env.distribution.treasury;
  if (!treasuryId) throw routingError('TREASURY_PUBLIC is not configured', 500, 'ConfigError');
  if (!isRoutableSymbol(fromCode)) throw routingError(`${fromCode} is not in ROUTING_ASSETS`, 400, 'ValidationError');
  const from = resolveAsset(fromCode).ref;
  const to = resolveAsset(env.routing.settlementAssetCode).ref;
  if (sameAsset(from, to)) throw routingError(`${fromCode} is already the settlement asset`, 400, 'ValidationError');
  const sendAmount = fromStroops(toStroops(amount));

  const account = await horizon.loadAccount(treasuryId);
  const held = readBalances(account.balances).find((b) => sameAsset(b.asset, from));
  if (!held || toStroops(held.balance) < toStroops(sendAmount)) {
    throw routingError(`Treasury holds ${held?.balance ?? '0'} ${from.code}, less than ${sendAmount}`, 422, 'InsufficientBalance');
  }

  const paths = await horizon.strictSendPaths(toAsset(from), sendAmount, [toAsset(to)]).call();
  const route = bestStrictSendPath(paths.records as unknown as StrictSendPath[]);
  const { tx, estimated, minOut, expiresAt } = buildConversionTx(account, from, to, sendAmount, route, env.routing.slippageBps);

  return {
    treasury: treasuryId,
    network: env.network,
    from,
    to,
    sendAmount,
    estimatedDestinationAmount: fromStroops(estimated),
    minDestinationAmount: fromStroops(minOut),
    path: route.path.map(pathRef),
    xdr: tx.toXDR(),
    hash: tx.hash().toString('hex'),
    expiresAt,
    signaturesRequired: account.thresholds.med_threshold,
  };
}
