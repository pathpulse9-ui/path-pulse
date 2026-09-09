import type {
  AssetRef,
  RoutingQuote,
  TreasuryConversion,
  TreasuryRoutingPlan,
} from '@pathpulse/contract';
import { env } from '../config/env.js';
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
