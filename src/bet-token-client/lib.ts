/* eslint-disable */

import { BaseGearProgram, GearApi } from '@gear-js/api';
import { TypeRegistry } from '@polkadot/types';
import { ActorId, QueryBuilder, TransactionBuilder } from 'sails-js';

export interface ClaimConfig {
  base_claim_amount: number | string | bigint;
  max_claim_amount: number | string | bigint;
  streak_step: number | string | bigint;
  streak_cap_days: number;
  claim_period: number | string | bigint;
  day_start_offset_ms: number | string | bigint;
  claim_paused: boolean;
}

export interface ClaimState {
  last_claim_at: number | string | bigint | null;
  streak_days: number;
  total_claimed: number | string | bigint;
  claim_count: number;
}

export interface ClaimPreview {
  amount: number | string | bigint;
  streak_days: number;
  next_claim_at: number | string | bigint | null;
  can_claim_now: boolean;
}

export class SailsProgram {
  public readonly registry: TypeRegistry;
  public readonly betToken: BetToken;
  private readonly _program: BaseGearProgram;

  constructor(public api: GearApi, programId: `0x${string}`) {
    const types: Record<string, any> = {
      ClaimConfig: {
        base_claim_amount: 'u256',
        max_claim_amount: 'u256',
        streak_step: 'u256',
        streak_cap_days: 'u32',
        claim_period: 'u64',
        day_start_offset_ms: 'u64',
        claim_paused: 'bool',
      },
      ClaimState: {
        last_claim_at: 'Option<u64>',
        streak_days: 'u32',
        total_claimed: 'u256',
        claim_count: 'u32',
      },
      ClaimPreview: {
        amount: 'u256',
        streak_days: 'u32',
        next_claim_at: 'Option<u64>',
        can_claim_now: 'bool',
      },
    };

    this.registry = new TypeRegistry();
    this.registry.setKnownTypes({ types });
    this.registry.register(types);
    this._program = new BaseGearProgram(programId, api);
    this.betToken = new BetToken(this);
  }

  public get programId(): `0x${string}` {
    return this._program.id;
  }
}

export class BetToken {
  constructor(private _program: SailsProgram) {}

  public approve(
    spender: ActorId,
    value: number | string | bigint,
  ): TransactionBuilder<boolean> {
    return new TransactionBuilder<boolean>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BetToken',
      'Approve',
      [spender, value],
      '([u8;32], u256)',
      'bool',
      this._program.programId,
    );
  }

  public claim(): TransactionBuilder<ClaimState> {
    return new TransactionBuilder<ClaimState>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BetToken',
      'Claim',
      null,
      null,
      'ClaimState',
      this._program.programId,
    );
  }

  public adminMint(
    to: ActorId,
    value: number | string | bigint,
  ): TransactionBuilder<null> {
    return new TransactionBuilder<null>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BetToken',
      'AdminMint',
      [to, value],
      '([u8;32], u256)',
      'Null',
      this._program.programId,
    );
  }

  public setClaimDayStartOffset(
    dayStartOffsetMs: number | string | bigint,
  ): TransactionBuilder<null> {
    return new TransactionBuilder<null>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BetToken',
      'SetClaimDayStartOffset',
      dayStartOffsetMs,
      'u64',
      'Null',
      this._program.programId,
    );
  }

  public allowance(
    owner: ActorId,
    spender: ActorId,
  ): QueryBuilder<number | string | bigint> {
    return new QueryBuilder<number | string | bigint>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BetToken',
      'Allowance',
      [owner, spender],
      '([u8;32], [u8;32])',
      'u256',
    );
  }

  public balanceOf(account: ActorId): QueryBuilder<number | string | bigint> {
    return new QueryBuilder<number | string | bigint>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BetToken',
      'BalanceOf',
      account,
      '[u8;32]',
      'u256',
    );
  }

  public decimals(): QueryBuilder<number> {
    return new QueryBuilder<number>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BetToken',
      'Decimals',
      null,
      null,
      'u8',
    );
  }

  public symbol(): QueryBuilder<string> {
    return new QueryBuilder<string>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BetToken',
      'Symbol',
      null,
      null,
      'String',
    );
  }

  public getClaimConfig(): QueryBuilder<ClaimConfig> {
    return new QueryBuilder<ClaimConfig>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BetToken',
      'GetClaimConfig',
      null,
      null,
      'ClaimConfig',
    );
  }

  public getClaimPreview(user: ActorId): QueryBuilder<ClaimPreview> {
    return new QueryBuilder<ClaimPreview>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BetToken',
      'GetClaimPreview',
      user,
      '[u8;32]',
      'ClaimPreview',
    );
  }

  public getClaimState(user: ActorId): QueryBuilder<ClaimState> {
    return new QueryBuilder<ClaimState>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BetToken',
      'GetClaimState',
      user,
      '[u8;32]',
      'ClaimState',
    );
  }
}
