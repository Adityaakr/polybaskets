import { GearApi, HexString } from '@gear-js/api';
import { TypeRegistry } from '@polkadot/types';
import { TransactionBuilder, ActorId, QueryBuilder } from 'sails-js';
export declare class SailsProgram {
    api: GearApi;
    readonly registry: TypeRegistry;
    readonly basketMarket: BasketMarket;
    private _program?;
    constructor(api: GearApi, programId?: `0x${string}`);
    get programId(): `0x${string}`;
    newCtorFromCode(code: Uint8Array | Buffer | HexString, settler_role: ActorId, liveness_seconds: number | string | bigint): TransactionBuilder<null>;
    newCtorFromCodeId(codeId: `0x${string}`, settler_role: ActorId, liveness_seconds: number | string | bigint): TransactionBuilder<null>;
}
export declare class BasketMarket {
    private _program;
    constructor(_program: SailsProgram);
    betOnBasket(basket_id: number | string | bigint): TransactionBuilder<{
        ok: number | string | bigint;
    } | {
        err: string;
    }>;
    claim(basket_id: number | string | bigint): TransactionBuilder<{
        ok: number | string | bigint;
    } | {
        err: string;
    }>;
    createBasket(name: string, description: string, items: Array<BasketItem>): TransactionBuilder<{
        ok: number | string | bigint;
    } | {
        err: string;
    }>;
    finalizeSettlement(basket_id: number | string | bigint): TransactionBuilder<{
        ok: null;
    } | {
        err: string;
    }>;
    proposeSettlement(basket_id: number | string | bigint, item_resolutions: Array<ItemResolution>, payload: string): TransactionBuilder<{
        ok: null;
    } | {
        err: string;
    }>;
    getBasket(basket_id: number | string | bigint): QueryBuilder<{
        ok: Basket;
    } | {
        err: string;
    }>;
    getBasketCount(): QueryBuilder<bigint>;
    getConfig(): QueryBuilder<[ActorId, number | string | bigint]>;
    getPositions(user: ActorId): QueryBuilder<Array<Position>>;
    getSettlement(basket_id: number | string | bigint): QueryBuilder<{
        ok: Settlement;
    } | {
        err: string;
    }>;
}
//# sourceMappingURL=lib.d.ts.map