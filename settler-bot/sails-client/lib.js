/* eslint-disable */
import { BaseGearProgram } from '@gear-js/api';
import { TypeRegistry } from '@polkadot/types';
import { TransactionBuilder, QueryBuilder } from 'sails-js';
export class SailsProgram {
    api;
    registry;
    basketMarket;
    _program;
    constructor(api, programId) {
        this.api = api;
        const types = {
            BasketItem: { "poly_market_id": "String", "poly_slug": "String", "weight_bps": "u16" },
            ItemResolution: { "item_index": "u8", "resolved": "Outcome", "poly_slug": "String", "poly_condition_id": "Option<String>", "poly_price_yes": "u16", "poly_price_no": "u16" },
            Outcome: { "_enum": ["YES", "NO"] },
            Basket: { "id": "u64", "creator": "[u8;32]", "name": "String", "description": "String", "items": "Vec<BasketItem>", "created_at": "u64", "status": "BasketStatus" },
            BasketStatus: { "_enum": ["Active", "Settled", "Closed"] },
            Position: { "basket_id": "u64", "user": "[u8;32]", "shares": "u128", "claimed": "bool" },
            Settlement: { "basket_id": "u64", "proposer": "[u8;32]", "item_resolutions": "Vec<ItemResolution>", "payout_per_share": "u128", "payload": "String", "proposed_at": "u64", "challenge_deadline": "u64", "finalized_at": "Option<u64>", "status": "SettlementStatus" },
            SettlementStatus: { "_enum": ["Proposed", "Finalized", "Disputed"] },
        };
        this.registry = new TypeRegistry();
        this.registry.setKnownTypes({ types });
        this.registry.register(types);
        if (programId) {
            this._program = new BaseGearProgram(programId, api);
        }
        this.basketMarket = new BasketMarket(this);
    }
    get programId() {
        if (!this._program)
            throw new Error(`Program ID is not set`);
        return this._program.id;
    }
    newCtorFromCode(code, settler_role, liveness_seconds) {
        const builder = new TransactionBuilder(this.api, this.registry, 'upload_program', null, 'New', [settler_role, liveness_seconds], '([u8;32], u64)', 'String', code, async (programId) => {
            this._program = await BaseGearProgram.new(programId, this.api);
        });
        return builder;
    }
    newCtorFromCodeId(codeId, settler_role, liveness_seconds) {
        const builder = new TransactionBuilder(this.api, this.registry, 'create_program', null, 'New', [settler_role, liveness_seconds], '([u8;32], u64)', 'String', codeId, async (programId) => {
            this._program = await BaseGearProgram.new(programId, this.api);
        });
        return builder;
    }
}
export class BasketMarket {
    _program;
    constructor(_program) {
        this._program = _program;
    }
    betOnBasket(basket_id) {
        if (!this._program.programId)
            throw new Error('Program ID is not set');
        return new TransactionBuilder(this._program.api, this._program.registry, 'send_message', 'BasketMarket', 'BetOnBasket', basket_id, 'u64', 'Result<u128, String>', this._program.programId);
    }
    claim(basket_id) {
        if (!this._program.programId)
            throw new Error('Program ID is not set');
        return new TransactionBuilder(this._program.api, this._program.registry, 'send_message', 'BasketMarket', 'Claim', basket_id, 'u64', 'Result<u128, String>', this._program.programId);
    }
    createBasket(name, description, items) {
        if (!this._program.programId)
            throw new Error('Program ID is not set');
        return new TransactionBuilder(this._program.api, this._program.registry, 'send_message', 'BasketMarket', 'CreateBasket', [name, description, items], '(String, String, Vec<BasketItem>)', 'Result<u64, String>', this._program.programId);
    }
    finalizeSettlement(basket_id) {
        if (!this._program.programId)
            throw new Error('Program ID is not set');
        return new TransactionBuilder(this._program.api, this._program.registry, 'send_message', 'BasketMarket', 'FinalizeSettlement', basket_id, 'u64', 'Result<Null, String>', this._program.programId);
    }
    proposeSettlement(basket_id, item_resolutions, payload) {
        if (!this._program.programId)
            throw new Error('Program ID is not set');
        return new TransactionBuilder(this._program.api, this._program.registry, 'send_message', 'BasketMarket', 'ProposeSettlement', [basket_id, item_resolutions, payload], '(u64, Vec<ItemResolution>, String)', 'Result<Null, String>', this._program.programId);
    }
    getBasket(basket_id) {
        return new QueryBuilder(this._program.api, this._program.registry, this._program.programId, 'BasketMarket', 'GetBasket', basket_id, 'u64', 'Result<Basket, String>');
    }
    getBasketCount() {
        return new QueryBuilder(this._program.api, this._program.registry, this._program.programId, 'BasketMarket', 'GetBasketCount', null, null, 'u64');
    }
    getConfig() {
        return new QueryBuilder(this._program.api, this._program.registry, this._program.programId, 'BasketMarket', 'GetConfig', null, null, '([u8;32], u64)');
    }
    getPositions(user) {
        return new QueryBuilder(this._program.api, this._program.registry, this._program.programId, 'BasketMarket', 'GetPositions', user, '[u8;32]', 'Vec<Position>');
    }
    getSettlement(basket_id) {
        return new QueryBuilder(this._program.api, this._program.registry, this._program.programId, 'BasketMarket', 'GetSettlement', basket_id, 'u64', 'Result<Settlement, String>');
    }
}
//# sourceMappingURL=lib.js.map