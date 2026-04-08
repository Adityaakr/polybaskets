import { BaseGearProgram, GearApi } from '@gear-js/api';
import { TypeRegistry } from '@polkadot/types';
import { QueryBuilder } from 'sails-js';

export type Outcome = 'YES' | 'NO' | { YES?: null } | { NO?: null };

export type ChainBasket = {
  id: number;
  status: 'Active' | 'SettlementPending' | 'Settled' | Record<string, unknown>;
  asset_kind: 'Bet' | 'Vara' | Record<string, unknown>;
  items: Array<{
    poly_market_id: string;
    poly_slug: string;
    weight_bps: number;
    selected_outcome: Outcome;
  }>;
};

type BasketQueryResult<T> = { ok: T } | { err: string };

class BasketMarketClient {
  constructor(
    private readonly api: GearApi,
    private readonly registry: TypeRegistry,
    private readonly programId: `0x${string}`,
  ) {}

  getBasket(
    basketId: number,
  ): QueryBuilder<BasketQueryResult<ChainBasket>> {
    return new QueryBuilder<BasketQueryResult<ChainBasket>>(
      this.api,
      this.registry,
      this.programId,
      'BasketMarket',
      'GetBasket',
      basketId,
      'u64',
      'Result<(Basket), String>',
    );
  }
}

const types = {
  BasketItem: {
    poly_market_id: 'String',
    poly_slug: 'String',
    weight_bps: 'u16',
    selected_outcome: 'Outcome',
  },
  Outcome: { _enum: ['YES', 'NO'] },
  BasketAssetKind: { _enum: ['Vara', 'Bet'] },
  BasketStatus: { _enum: ['Active', 'SettlementPending', 'Settled'] },
  Basket: {
    id: 'u64',
    creator: '[u8;32]',
    name: 'String',
    description: 'String',
    items: 'Vec<BasketItem>',
    created_at: 'u64',
    status: 'BasketStatus',
    asset_kind: 'BasketAssetKind',
  },
};

const registry = new TypeRegistry();
registry.setKnownTypes({ types });
registry.register(types);

const getStatusName = (value: ChainBasket['status']): string =>
  typeof value === 'string' ? value : Object.keys(value ?? {})[0] ?? 'Unknown';

const getAssetKindName = (value: ChainBasket['asset_kind']): string =>
  typeof value === 'string' ? value : Object.keys(value ?? {})[0] ?? 'Unknown';

export class BasketReader {
  private api: GearApi | null = null;
  private client: BasketMarketClient | null = null;

  constructor(
    private readonly rpcUrl: string,
    private readonly basketMarketProgramId: `0x${string}`,
  ) {}

  async init() {
    if (this.api && this.client) {
      return;
    }

    this.api = await GearApi.create({ providerAddress: this.rpcUrl });
    this.client = new BasketMarketClient(this.api, registry, this.basketMarketProgramId);
    await BaseGearProgram.new(this.basketMarketProgramId, this.api);
  }

  async getBasket(basketId: number): Promise<ChainBasket> {
    await this.init();

    const result = await this.client!.getBasket(basketId).call();
    if ('err' in result) {
      throw new Error(`Basket ${basketId} not found`);
    }

    const basket = result.ok;
    if (getStatusName(basket.status) !== 'Active') {
      throw new Error(`Basket ${basketId} is not active`);
    }
    if (getAssetKindName(basket.asset_kind) !== 'Bet') {
      throw new Error(`Basket ${basketId} is not a BET lane basket`);
    }

    return basket;
  }
}
