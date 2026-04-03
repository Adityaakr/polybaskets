/* eslint-disable */

import { BaseGearProgram, GearApi } from '@gear-js/api';
import { TypeRegistry } from '@polkadot/types';
import { ActorId, QueryBuilder, TransactionBuilder } from 'sails-js';

export interface BetLaneConfig {
  min_bet: number | string | bigint;
  max_bet: number | string | bigint;
  payouts_allowed_while_paused: boolean;
}

export interface BetLanePosition {
  shares: number | string | bigint;
  claimed: boolean;
  index_at_creation_bps: number;
}

export class SailsProgram {
  public readonly registry: TypeRegistry;
  public readonly betLane: BetLane;
  private readonly _program: BaseGearProgram;

  constructor(public api: GearApi, programId: `0x${string}`) {
    const types: Record<string, any> = {
      BetLaneConfig: {
        min_bet: 'u256',
        max_bet: 'u256',
        payouts_allowed_while_paused: 'bool',
      },
      Position: {
        shares: 'u256',
        claimed: 'bool',
        index_at_creation_bps: 'u16',
      },
    };

    this.registry = new TypeRegistry();
    this.registry.setKnownTypes({ types });
    this.registry.register(types);
    this._program = new BaseGearProgram(programId, api);
    this.betLane = new BetLane(this);
  }

  public get programId(): `0x${string}` {
    return this._program.id;
  }
}

export class BetLane {
  constructor(private _program: SailsProgram) {}

  public placeBet(
    basket_id: number | string | bigint,
    amount: number | string | bigint,
    index_at_creation_bps: number,
  ): TransactionBuilder<number | string | bigint> {
    return new TransactionBuilder<number | string | bigint>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BetLane',
      'PlaceBet',
      [basket_id, amount, index_at_creation_bps],
      '(u64, u256, u16)',
      'u256',
      this._program.programId,
    );
  }

  public claim(
    basket_id: number | string | bigint,
  ): TransactionBuilder<number | string | bigint> {
    return new TransactionBuilder<number | string | bigint>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BetLane',
      'Claim',
      basket_id,
      'u64',
      'u256',
      this._program.programId,
    );
  }

  public getConfig(): QueryBuilder<BetLaneConfig> {
    return new QueryBuilder<BetLaneConfig>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BetLane',
      'GetConfig',
      null,
      null,
      'BetLaneConfig',
    );
  }

  public getPosition(
    user: ActorId,
    basket_id: number | string | bigint,
  ): QueryBuilder<BetLanePosition> {
    return new QueryBuilder<BetLanePosition>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BetLane',
      'GetPosition',
      [user, basket_id],
      '([u8;32], u64)',
      'Position',
    );
  }
}
