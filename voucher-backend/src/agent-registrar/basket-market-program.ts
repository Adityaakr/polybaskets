/* eslint-disable */
/**
 * Minimal vendored BasketMarket Sails client.
 * Only agent-query methods are included (GetAgent, GetAllAgents, GetAgentCount).
 * Trimmed from the frontend's src/basket-market-client/lib.ts.
 *
 * Note: Uses @gear-js/api v0.39.x (backend version). Unlike the frontend which
 * uses BaseGearProgram (v0.44+), we pass the programId hex string directly to
 * QueryBuilder — which is all it needs.
 */

import { GearApi } from '@gear-js/api';
import { TypeRegistry } from '@polkadot/types';
import { QueryBuilder, ActorId } from 'sails-js';

export type AgentInfoRaw = {
  address: string;
  name: string;
  registered_at: bigint | number | string;
  name_updated_at: bigint | number | string;
};

export class BasketMarketProgram {
  public readonly registry: TypeRegistry;
  public readonly basketMarket: BasketMarketService;
  public readonly programId: `0x${string}`;

  constructor(public api: GearApi, programId: `0x${string}`) {
    const types: Record<string, any> = {
      AgentInfo: {
        address: '[u8;32]',
        name: 'String',
        registered_at: 'u64',
        name_updated_at: 'u64',
      },
      BasketMarketError: {
        _enum: [
          'Unauthorized',
          'BasketNotFound',
          'BasketNotActive',
          'BasketAssetMismatch',
          'NoItems',
          'NotEnoughItems',
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
          'AgentNameTooShort',
          'AgentNameTooLong',
          'AgentNameInvalid',
          'AgentNameTaken',
          'AgentRenameCooldown',
        ],
      },
    };

    this.registry = new TypeRegistry();
    this.registry.setKnownTypes({ types });
    this.registry.register(types);

    this.programId = programId;
    this.basketMarket = new BasketMarketService(this);
  }
}

export class BasketMarketService {
  constructor(private _program: BasketMarketProgram) {}

  public getAgent(address: ActorId): QueryBuilder<AgentInfoRaw | null> {
    return new QueryBuilder<AgentInfoRaw | null>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BasketMarket',
      'GetAgent',
      address,
      '[u8;32]',
      'Option<AgentInfo>',
    );
  }

  public getAgentCount(): QueryBuilder<bigint> {
    return new QueryBuilder<bigint>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BasketMarket',
      'GetAgentCount',
      null,
      null,
      'u64',
    );
  }

  public getAllAgents(): QueryBuilder<Array<AgentInfoRaw>> {
    return new QueryBuilder<Array<AgentInfoRaw>>(
      this._program.api,
      this._program.registry,
      this._program.programId,
      'BasketMarket',
      'GetAllAgents',
      null,
      null,
      'Vec<AgentInfo>',
    );
  }
}
