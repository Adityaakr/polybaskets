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
    newCtorFromCode(code: Uint8Array | Buffer | HexString, init: BasketMarketInit): TransactionBuilder<null>;
    newCtorFromCodeId(codeId: `0x${string}`, init: BasketMarketInit): TransactionBuilder<null>;
}
export declare class BasketMarket {
    private _program;
    constructor(_program: SailsProgram);
    betOnBasket(basket_id: number | string | bigint, index_at_creation_bps: number): TransactionBuilder<number | string | bigint>;
    claim(basket_id: number | string | bigint): TransactionBuilder<number | string | bigint>;
    createBasket(name: string, description: string, items: Array<BasketItem>, asset_kind: BasketAssetKind): TransactionBuilder<number | string | bigint>;
    finalizeSettlement(basket_id: number | string | bigint): TransactionBuilder<null>;
    proposeSettlement(basket_id: number | string | bigint, item_resolutions: Array<ItemResolution>, payload: string): TransactionBuilder<null>;
    setConfig(config: BasketMarketConfig): TransactionBuilder<null>;
    setVaraEnabled(enabled: boolean): TransactionBuilder<null>;
    getBasket(basket_id: number | string | bigint): QueryBuilder<BasketMarketResult<Basket>>;
    getBasketCount(): QueryBuilder<bigint>;
    getConfig(): QueryBuilder<BasketMarketConfig>;
    getPositions(user: ActorId): QueryBuilder<Array<Position>>;
    getSettlement(basket_id: number | string | bigint): QueryBuilder<BasketMarketResult<Settlement>>;
    isVaraEnabled(): QueryBuilder<boolean>;
}
type BasketMarketResult<T> = {
    ok: T;
} | {
    err: BasketMarketError;
};
export {};
