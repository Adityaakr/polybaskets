/* eslint-disable */

import { GearApi, BaseGearProgram, HexString } from '@gear-js/api';
import { TypeRegistry } from '@polkadot/types';
import { TransactionBuilder, ActorId, QueryBuilder } from 'sails-js';

type BasketMarketResult<T> = { ok: T } | { err: BasketMarketError };

export class SailsProgram {
  public readonly registry: TypeRegistry;
  public readonly basketMarket: BasketMarket;
  private _program?: BaseGearProgram;

  constructor(public api: GearApi, programId?: `0x${string}`) {
    const types: Record<string, any> = {
      BasketMarketInit: {
        admin_role: '[u8;32]',
        settler_role: '[u8;32]',
        liveness_ms: 'u64',
      },
      BasketMarketConfig: {
        admin_role: '[u8;32]',
        settler_role: '[u8;32]',
        liveness_ms: 'u64',
        vara_enabled: 'bool',
      },
      BasketMarketError: {
        _enum: [
          'Unauthorized',
          'BasketNotFound',
          'BasketNotActive',
          'BasketAssetMismatch',
          'NoItems',
          'InvalidWeights',
          'DuplicateBasketItem',
          'TooManyItems',
          'NameTooLong',
          'DescriptionTooLong',
          'MarketIdTooLong',
          'SlugTooLong',
          'PayloadTooLong',
          'VaraDisabled',
          'SettlementAlreadyExists',
          'SettlementNotFound',
          'SettlementNotProposed',
          'SettlementNotFinalized',
          'ChallengeDeadlineNotPassed',
          'InvalidIndexAtCreation',
          'InvalidBetAmount',
          'InvalidResolutionCount',
          'DuplicateResolutionIndex',
          'ResolutionIndexOutOfBounds',
          'ResolutionSlugMismatch',
          'InvalidResolution',
          'AlreadyClaimed',
          'NothingToClaim',
          'TransferFailed',
          'MathOverflow',
          'EventEmitFailed',
          'InvalidConfig',
        ],
      },
      BasketItem: {
        poly_market_id: 'String',
        poly_slug: 'String',
        weight_bps: 'u16',
        selected_outcome: 'Outcome',
      },
      ItemResolution: {
        item_index: 'u8',
        resolved: 'Outcome',
        poly_slug: 'String',
        poly_condition_id: 'Option<String>',
        poly_price_yes: 'u16',
        poly_price_no: 'u16',
      },
      Outcome: { _enum: ['YES', 'NO'] },
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
      BasketAssetKind: { _enum: ['Vara', 'Bet'] },
      BasketStatus: { _enum: ['Active', 'SettlementPending', 'Settled'] },
      Position: {
        basket_id: 'u64',
        user: '[u8;32]',
        shares: 'u128',
        claimed: 'bool',
        index_at_creation_bps: 'u16',
      },
      Settlement: {
        basket_id: 'u64',
        proposer: '[u8;32]',
        item_resolutions: 'Vec<ItemResolution>',
        payout_per_share: 'u128',
        payload: 'String',
        proposed_at: 'u64',
        challenge_deadline: 'u64',
        finalized_at: 'Option<u64>',
        status: 'SettlementStatus',
      },
      SettlementStatus: { _enum: ['Proposed', 'Finalized'] },
    };

    this.registry = new TypeRegistry();
    this.registry.setKnownTypes({ types });
    this.registry.register(types);

    if (programId) {
      this._program = new BaseGearProgram(programId, api);
    }

    this.basketMarket = new BasketMarket(this);
  }

  public get programId(): `0x${string}` {
    if (!this._program) throw new Error('Program ID is not set');
    return this._program.id;
  }

  newCtorFromCode(code: Uint8Array | Buffer | HexString, init: BasketMarketInit): TransactionBuilder<null> {
    return new TransactionBuilder<null>(
      this.api,
      this.registry,
      'upload_program',
      null,
      'New',
      [init],
      '(BasketMarketInit)',
      'String',
      code,
      async (programId) =>  {
        this._program = await BaseGearProgram.new(programId, this.api);
      }
    );
  }

  newCtorFromCodeId(codeId: `0x${string}`, init: BasketMarketInit) {
    return new TransactionBuilder<null>(
      this.api,
      this.registry,
      'create_program',
      null,
      'New',
      [init],
      '(BasketMarketInit)',
      'String',
      codeId,
      async (programId) =>  {
        this._program = await BaseGearProgram.new(programId, this.api);
      }
    );
  }
}

export class BasketMarket {
  constructor(private _program: SailsProgram) {}

  public betOnBasket(
    basket_id: number | string | bigint,
    index_at_creation_bps: number,
  ): TransactionBuilder<number | string | bigint> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<number | string | bigint>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BasketMarket',
      'BetOnBasket',
      [basket_id, index_at_creation_bps],
      '(u64, u16)',
      'u128',
      this._program.programId,
    );
  }

  public claim(basket_id: number | string | bigint): TransactionBuilder<number | string | bigint> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<number | string | bigint>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BasketMarket',
      'Claim',
      basket_id,
      'u64',
      'u128',
      this._program.programId,
    );
  }

  public createBasket(
    name: string,
    description: string,
    items: Array<BasketItem>,
    asset_kind: BasketAssetKind,
  ): TransactionBuilder<number | string | bigint> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<number | string | bigint>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BasketMarket',
      'CreateBasket',
      [name, description, items, asset_kind],
      '(String, String, Vec<BasketItem>, BasketAssetKind)',
      'u64',
      this._program.programId,
    );
  }

  public finalizeSettlement(basket_id: number | string | bigint): TransactionBuilder<null> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<null>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BasketMarket',
      'FinalizeSettlement',
      basket_id,
      'u64',
      'Null',
      this._program.programId,
    );
  }

  public proposeSettlement(basket_id: number | string | bigint, item_resolutions: Array<ItemResolution>, payload: string): TransactionBuilder<null> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<null>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BasketMarket',
      'ProposeSettlement',
      [basket_id, item_resolutions, payload],
      '(u64, Vec<ItemResolution>, String)',
      'Null',
      this._program.programId,
    );
  }

  public setVaraEnabled(enabled: boolean): TransactionBuilder<null> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<null>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BasketMarket',
      'SetVaraEnabled',
      enabled,
      'bool',
      'Null',
      this._program.programId,
    );
  }

  public getBasket(basket_id: number | string | bigint): QueryBuilder<BasketMarketResult<Basket>> {
    return new QueryBuilder<BasketMarketResult<Basket>>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BasketMarket',
      'GetBasket',
      basket_id,
      'u64',
      'Result<Basket, BasketMarketError>',
    );
  }

  public getBasketCount(): QueryBuilder<bigint> {
    return new QueryBuilder<bigint>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BasketMarket',
      'GetBasketCount',
      null,
      null,
      'u64',
    );
  }

  public getConfig(): QueryBuilder<BasketMarketConfig> {
    return new QueryBuilder<BasketMarketConfig>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BasketMarket',
      'GetConfig',
      null,
      null,
      'BasketMarketConfig',
    );
  }

  public getPositions(user: ActorId): QueryBuilder<Array<Position>> {
    return new QueryBuilder<Array<Position>>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BasketMarket',
      'GetPositions',
      user,
      '[u8;32]',
      'Vec<Position>',
    );
  }

  public getSettlement(basket_id: number | string | bigint): QueryBuilder<BasketMarketResult<Settlement>> {
    return new QueryBuilder<BasketMarketResult<Settlement>>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BasketMarket',
      'GetSettlement',
      basket_id,
      'u64',
      'Result<Settlement, BasketMarketError>',
    );
  }

  public isVaraEnabled(): QueryBuilder<boolean> {
    return new QueryBuilder<boolean>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BasketMarket',
      'IsVaraEnabled',
      null,
      null,
      'bool',
    );
  }
}
