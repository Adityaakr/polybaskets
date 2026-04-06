// Vara.eth basket market client - wraps EthereumClient with basket operations
import { EthereumClient, VaraEthApi, WsVaraEthProvider, getMirrorClient } from '@vara-eth/api';
import { PublicClient, WalletClient } from 'viem';
import { TypeRegistry } from '@polkadot/types';
import { Sails } from 'sails-js';
import { SailsIdlParser } from 'sails-js-parser';
import { ENV } from '@/env.ts';

// Types matching the program
export interface BasketItem {
  poly_market_id: string;
  poly_slug: string;
  weight_bps: number;
  selected_outcome: 'YES' | 'NO';
}

export interface Basket {
  id: bigint;
  creator: `0x${string}`;
  name: string;
  description: string;
  items: BasketItem[];
  created_at: bigint;
  status: 'Active' | 'SettlementPending' | 'Settled';
  asset_kind: 'Vara' | 'Bet';
}

export interface Position {
  basket_id: bigint;
  user: `0x${string}`;
  shares: bigint;
  claimed: boolean;
  index_at_creation_bps?: number; // Index at creation in basis points (0-10000), optional for backwards compatibility
}

export interface ItemResolution {
  item_index: number;
  resolved: 'YES' | 'NO';
  poly_slug: string;
  poly_condition_id: string | null;
  poly_price_yes: number;
  poly_price_no: number;
}

export interface Settlement {
  basket_id: bigint;
  proposer: `0x${string}`;
  item_resolutions: ItemResolution[];
  payout_per_share: bigint;
  payload: string;
  proposed_at: bigint;
  challenge_deadline: bigint;
  finalized_at: bigint | null;
  status: 'Proposed' | 'Finalized';
}

export class VaraEthBasketMarket {
  private registry: TypeRegistry;
  private api: VaraEthApi | null = null;
  private mirror: ReturnType<typeof getMirrorClient> | null = null;
  private sails: Sails | null = null;

  constructor(
    private ethereumClient: EthereumClient,
    private programId: `0x${string}`,
    private userAddress: `0x${string}`,
    private publicClient: PublicClient,
    private walletClient: WalletClient
  ) {
    // Initialize type registry with program types
    const types: Record<string, any> = {
      BasketItem: {"poly_market_id":"String","poly_slug":"String","weight_bps":"u16","selected_outcome":"Outcome"},
      ItemResolution: {"item_index":"u8","resolved":"Outcome","poly_slug":"String","poly_condition_id":"Option<String>","poly_price_yes":"u16","poly_price_no":"u16"},
      Outcome: {"_enum":["YES","NO"]},
      Basket: {"id":"u64","creator":"[u8;32]","name":"String","description":"String","items":"Vec<BasketItem>","created_at":"u64","status":"BasketStatus","asset_kind":"BasketAssetKind"},
      BasketAssetKind: {"_enum":["Vara","Bet"]},
      BasketStatus: {"_enum":["Active","SettlementPending","Settled"]},
      Position: {"basket_id":"u64","user":"[u8;32]","shares":"u128","claimed":"bool","index_at_creation_bps":"u16"},
      Settlement: {"basket_id":"u64","proposer":"[u8;32]","item_resolutions":"Vec<ItemResolution>","payout_per_share":"u128","payload":"String","proposed_at":"u64","challenge_deadline":"u64","finalized_at":"Option<u64>","status":"SettlementStatus"},
      SettlementStatus: {"_enum":["Proposed","Finalized"]},
    };

    this.registry = new TypeRegistry();
    this.registry.setKnownTypes({ types });
    this.registry.register(types);
  }

  // Initialize Sails with IDL for proper encoding
  private async getSails(): Promise<Sails> {
    if (!this.sails) {
      try {
        // Load IDL from public folder or fetch it
        const idlResponse = await fetch('/polymarket-mirror.idl');
        if (!idlResponse.ok) {
          throw new Error('IDL file not found. Please ensure polymarket-mirror.idl is in the public folder.');
        }
        const idlContent = await idlResponse.text();
        
        const parser = await SailsIdlParser.new();
        const sails = new Sails(parser);
        await sails.parseIdl(idlContent);
        this.sails = sails;
        console.log('[VaraEth] Sails IDL loaded successfully');
      } catch (error) {
        console.error('[VaraEth] Failed to load IDL, falling back to manual encoding:', error);
        throw error; // Re-throw so caller knows sails isn't available
      }
    }
    return this.sails!;
  }

  // Initialize VaraEthApi for injected transactions (lazy initialization)
  private async getApi(): Promise<VaraEthApi> {
    if (!this.api) {
      try {
        // Try to connect to Vara.eth WebSocket API for injected transactions
        const wsUrl = ENV.VARAETH_WS || 'wss://hoodi-reth-rpc.gear-tech.io/ws';
        const provider = new WsVaraEthProvider(wsUrl);
        this.api = new VaraEthApi(provider, this.ethereumClient);
        
        // Connect WebSocket provider
        await provider.connect();
        
        console.log('[VaraEth] VaraEthApi initialized for injected transactions');
      } catch (error) {
        console.warn('[VaraEth] Failed to initialize VaraEthApi, will use classic transactions:', error);
        throw error; // Will trigger fallback to classic
      }
    }
    return this.api;
  }

  // Browser-compatible hex conversion helpers (replaces Buffer)
  private uint8ArrayToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private hexToUint8Array(hex: string): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
    }
    return bytes;
  }

  // Create a new basket (try injected first for gasless, fallback to classic)
  async createBasket(
    name: string,
    description: string,
    items: BasketItem[]
  ): Promise<bigint> {
    // First, verify program is responsive by querying GetBasketCount
    try {
      console.log('[VaraEth] Checking if program is responsive...');
      const api = await this.getApi();
      // Try to query GetBasketCount - this is a simple query that should work if program is alive
      const queryPayload = this.encodeGetBasketCount();
      const queryReply = await api.call.program.calculateReplyForHandle(
        this.userAddress,
        this.programId,
        queryPayload
      );
      console.log('[VaraEth] Program is responsive. GetBasketCount query succeeded.');
    } catch (queryError: any) {
      console.warn('[VaraEth] Program query failed. Program may not be initialized or may have insufficient balance:', queryError.message);
      // Continue anyway - the transaction might still work
    }
    
    // Check if program is initialized first
    const isInitialized = await this.checkInitialized();
    if (!isInitialized) {
      console.warn('[VaraEth] Program may not be initialized. Attempting to create basket anyway...');
      throw new Error(
        'Program appears to be uninitialized. Please initialize the program first by calling the constructor.\n\n' +
        'You can initialize it by calling: basketMarket.initialize(settlerRole, livenessSeconds)\n' +
        'Or use the initialization button in the UI.'
      );
    }
    
    // Use Sails to encode the message
    // Format: CreateBasket { name, description, items, asset_kind }
    const payload = await this.encodeCreateBasket(name, description, items);
    
    // Try injected transaction first (gasless, pre-confirmed)
    try {
      return await this.createBasketInjected(payload);
    } catch (error: any) {
      console.warn('[VaraEth] Injected transaction failed, falling back to classic:', error.message);
      // Fallback to classic transaction (reliable, full L1 finality, user pays gas)
      return this.createBasketClassic(payload);
    }
  }

  // Injected transaction (gasless, pre-confirmed via WebSocket)
  private async createBasketInjected(payload: `0x${string}`): Promise<bigint> {
    try {
      const api = await this.getApi();
      
      console.log('[VaraEth] Sending createBasket via injected transaction (gasless)...');
      
      const injected = await api.createInjectedTransaction({
        destination: this.programId,
        payload: payload as `0x${string}`,
        value: 0n,
      });
      
      const result = await injected.sendAndWaitForPromise();
      
      // Check if transaction was rejected
      if (!result || (result as any).status === 'Reject') {
        const reason = (result as any)?.reason || 'Unknown reason';
        throw new Error(`Transaction rejected: ${reason}`);
      }
      
      console.log('[VaraEth] Injected transaction accepted, waiting for reply...');
      
      // Decode response from reply payload
      // result should have a 'reply' property with 'payload'
      const replyPayload = (result as any)?.reply?.payload || '0x';
      const response = await this.decodeResponseFromPayload(replyPayload, 'Result<u64, String>');
      
      if ('err' in response) {
        throw new Error(`Failed to create basket: ${response.err}`);
      }
      
      console.log('[VaraEth] Basket created successfully via injected transaction, ID:', response.ok);
      return BigInt(response.ok);
    } catch (error: any) {
      console.error('[VaraEth] Injected transaction error:', error);
      throw error; // Re-throw to trigger fallback
    }
  }

  // Get Mirror client for classic transactions
  private getMirror() {
    if (!this.mirror) {
      this.mirror = getMirrorClient(this.programId, this.walletClient, this.publicClient);
    }
    return this.mirror;
  }

  // Classic transaction via Mirror (fallback method)
  private async createBasketClassic(payload: `0x${string}`): Promise<bigint> {
    try {
      console.log('[VaraEth] Sending createBasket transaction:', {
        programId: this.programId,
        payloadLength: payload.length,
        payloadPreview: payload.substring(0, 100) + '...'
      });
      
      const mirror = this.getMirror();
      const tx = await mirror.sendMessage(payload, 0n);
      const receipt = await tx.sendAndWaitForReceipt();
      
      console.log('[VaraEth] Transaction confirmed:', {
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber
      });
      
      // Wait for reply with timeout (30 seconds)
      console.log('[VaraEth] Setting up reply listener...');
      const replyListener = await tx.setupReplyListener();
      
      // Add timeout to prevent hanging indefinitely
      const replyPromise = replyListener.waitForReply();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Reply timeout after 30 seconds. Transaction confirmed but program did not reply.')), 30000);
      });
      
      let reply;
      try {
        reply = await Promise.race([replyPromise, timeoutPromise]);
      } catch (timeoutError: any) {
        console.error('[VaraEth] Reply timeout:', timeoutError.message);
        throw new Error('Transaction confirmed but the program did not respond. Please try again or check if the program is functioning correctly.');
      }
      const replyPayload = reply.payload || '0x';
      
      console.log('[VaraEth] Received reply:', {
        payloadLength: replyPayload.length,
        payloadPreview: replyPayload.substring(0, 100) + '...',
        fullPayloadHex: replyPayload
      });
      
      // Decode response
      try {
        const response = await this.decodeResponseFromPayload(replyPayload, 'Result<u64, String>');
        if ('err' in response) {
          const errorMsg = response.err;
          console.error('[VaraEth] Program returned error:', errorMsg);
          console.error('[VaraEth] Full error payload (hex):', replyPayload);
          
          // Check if this is an encoding/routing error
          if (errorMsg.includes('BasketMarket') || errorMsg.includes('CreateBasket') || errorMsg.length < 50) {
            throw new Error(
              `The program could not process your message.\n` +
              `Error: "${errorMsg}"\n\n` +
              `This usually means the message format is incorrect. Please check the console logs for details.`
            );
          }
          
          throw new Error(`Failed to create basket: ${errorMsg}`);
        }
        
        console.log('[VaraEth] Basket created successfully, ID:', response.ok);
        return BigInt(response.ok);
      } catch (decodeError: any) {
        // If decoding fails, check if it's a raw error string
        if (replyPayload && replyPayload !== '0x' && replyPayload.length < 200) {
          try {
            const stringDecoded = this.registry.createType('String', this.hexToUint8Array(replyPayload));
            const errorMessage = stringDecoded.toJSON() as string;
            throw new Error(`Program error: ${errorMessage}`);
          } catch {
            // Ignore, use original error
          }
        }
        throw new Error(`Failed to decode reply: ${decodeError.message}`);
      }
    } catch (error: any) {
      console.error('[VaraEth] CreateBasket error:', error);
      console.error('[VaraEth] Program ID:', this.programId);
      console.error('[VaraEth] Payload sent:', payload);
      
      // Provide helpful error message
      if (error.message?.includes('revert') || error.message?.includes('reverted')) {
        throw new Error(
          `Transaction reverted. Possible causes:\n` +
          `1. Program not initialized (constructor New() must be called)\n` +
          `2. Invalid message encoding\n` +
          `3. Program balance insufficient (needs wVARA)\n` +
          `4. Invalid basket parameters\n\n` +
          `Check: https://explorer.hoodi.network/address/${this.programId}\n` +
          `Original error: ${error.message}`
        );
      }
      
      throw error;
    }
  }

  // Check if program is initialized (by trying to get config)
  async checkInitialized(): Promise<boolean> {
    try {
      // Try to query GetConfig - if program is initialized, this should work
      const api = await this.getApi();
      // GetConfig query: service_name + query_name (empty args)
      // Format: [service_name (String)] + [query_name (String)]
      const serviceNameType = this.registry.createType('String', 'BasketMarket');
      const serviceEncoded = serviceNameType.toU8a();
      const queryNameType = this.registry.createType('String', 'GetConfig');
      const queryEncoded = queryNameType.toU8a();
      
      const configPayload = new Uint8Array(serviceEncoded.length + queryEncoded.length);
      configPayload.set(serviceEncoded, 0);
      configPayload.set(queryEncoded, serviceEncoded.length);
      const configPayloadHex = `0x${this.uint8ArrayToHex(configPayload)}`;
      
      const reply = await api.call.program.calculateReplyForHandle(
        this.userAddress,
        this.programId,
        configPayloadHex as `0x${string}`
      );
      const hasResponse = reply.payload && reply.payload !== '0x';
      console.log('[VaraEth] GetConfig query result:', { hasResponse, payloadPreview: reply.payload?.substring(0, 50) });
      return hasResponse;
    } catch (error: any) {
      console.warn('[VaraEth] Program may not be initialized or has insufficient balance:', error.message);
      return false;
    }
  }

  // Get basket by ID
  async getBasket(basketId: bigint): Promise<Basket> {
    // For state reads, we need to use VaraEthApi with calculateReplyForHandle
    // This is a query, not a state read
    try {
      const api = await this.getApi();
      const payload = this.encodeGetBasket(basketId);
      const reply = await api.call.program.calculateReplyForHandle(
        this.userAddress,
        this.programId,
        payload
      );
      // Decode reply payload to Basket
      return this.decodeBasket(reply.payload);
    } catch (error) {
      console.error('[VaraEth] GetBasket error:', error);
      throw error;
    }
  }

  // Bet on a basket (try injected first for gasless, fallback to classic)
  async betOnBasket(basketId: bigint, value: bigint, indexAtCreationBps: number): Promise<bigint> {
    const payload = await this.encodeBetOnBasket(basketId, indexAtCreationBps);
    
    // Try injected transaction first (gasless, pre-confirmed)
    try {
      return await this.betOnBasketInjected(payload, value);
    } catch (error: any) {
      console.warn('[VaraEth] Injected transaction failed, falling back to classic:', error.message);
      // Fallback to classic transaction (user pays gas)
      return this.betOnBasketClassic(payload, value);
    }
  }

  // Injected transaction for betting (gasless, pre-confirmed)
  private async betOnBasketInjected(payload: `0x${string}`, value: bigint): Promise<bigint> {
    try {
      const api = await this.getApi();
      
      const injected = await api.createInjectedTransaction({
        destination: this.programId,
        payload: payload as `0x${string}`,
        value: value,
      });
      
      const result = await injected.sendAndWaitForPromise();
      
      // Check if transaction was rejected
      if (!result || (result as any).status === 'Reject') {
        const reason = (result as any)?.reason || 'Unknown reason';
        throw new Error(`Transaction rejected: ${reason}`);
      }
      
      const replyPayload = (result as any)?.reply?.payload || '0x';
      const response = await this.decodeResponseFromPayload(replyPayload, 'Result<u128, String>');
      
      if ('err' in response) {
        throw new Error(`Failed to bet: ${response.err}`);
      }
      
      return BigInt(response.ok);
    } catch (error: any) {
      console.error('[VaraEth] Injected transaction error:', error);
      throw error;
    }
  }

  // Classic transaction via Mirror (fallback method)
  private async betOnBasketClassic(payload: `0x${string}`, value: bigint): Promise<bigint> {
    try {
      const mirror = this.getMirror();
      const tx = await mirror.sendMessage(payload, value);
      const receipt = await tx.sendAndWaitForReceipt();
      
      // Wait for reply
      const replyListener = await tx.setupReplyListener();
      const reply = await replyListener.waitForReply();
      const replyPayload = reply.payload || '0x';
      
      // Decode response
      const response = await this.decodeResponseFromPayload(replyPayload, 'Result<u128, String>');
      if ('err' in response) {
        throw new Error(`Failed to bet: ${response.err}`);
      }
      
      return BigInt(response.ok);
    } catch (error: any) {
      console.error('[VaraEth] BetOnBasket error:', error);
      throw error;
    }
  }

  // Get user positions
  async getPositions(userAddress: `0x${string}`): Promise<Position[]> {
    try {
      const api = await this.getApi();
      const payload = this.encodeGetPositions(userAddress);
      const reply = await api.call.program.calculateReplyForHandle(
        this.userAddress,
        this.programId,
        payload
      );
      return this.decodePositions(reply.payload);
    } catch (error) {
      console.error('[VaraEth] GetPositions error:', error);
      throw error;
    }
  }

  // Get settlement for a basket
  async getSettlement(basketId: bigint): Promise<Settlement | null> {
    try {
      const api = await this.getApi();
      const payload = this.encodeGetSettlement(basketId);
      const reply = await api.call.program.calculateReplyForHandle(
        this.userAddress,
        this.programId,
        payload
      );
      return reply.payload ? this.decodeSettlement(reply.payload) : null;
    } catch (error) {
      console.error('[VaraEth] GetSettlement error:', error);
      throw error;
    }
  }

  // Initialize the program by calling the constructor New(settler_role, liveness_seconds)
  // This must be called once before the program can be used
  async initialize(
    settlerRole: `0x${string}` = '0x2e20c7db6cc6c97fd10ec8e6191c6002cdbf3c41085047a6d779605fc702f427' as `0x${string}`,
    livenessSeconds: bigint = 720n // 12 minutes (720 seconds) default
  ): Promise<void> {
    const payload = this.encodeConstructor(settlerRole, livenessSeconds);
    
    // Try injected transaction first (gasless, pre-confirmed)
    try {
      return await this.initializeInjected(payload);
    } catch (error: any) {
      console.warn('[VaraEth] Injected transaction failed, falling back to classic:', error.message);
      // Fallback to classic transaction (user pays gas)
      return this.initializeClassic(payload);
    }
  }

  // Injected transaction for initialization (gasless, pre-confirmed)
  private async initializeInjected(payload: `0x${string}`): Promise<void> {
    try {
      const api = await this.getApi();
      
      const injected = await api.createInjectedTransaction({
        destination: this.programId,
        payload: payload as `0x${string}`,
        value: 0n,
      });
      
      const result = await injected.sendAndWaitForPromise();
      
      // Check if transaction was rejected
      if (!result || (result as any).status === 'Reject') {
        const reason = (result as any)?.reason || 'Unknown reason';
        throw new Error(`Transaction rejected: ${reason}`);
      }
      
      console.log('[VaraEth] Program initialized successfully via injected transaction');
    } catch (error: any) {
      console.error('[VaraEth] Injected transaction error:', error);
      throw error;
    }
  }

  // Classic transaction via Mirror (fallback method)
  private async initializeClassic(payload: `0x${string}`): Promise<void> {
    try {
      console.log('[VaraEth] Sending initialization transaction (classic)...', {
        programId: this.programId,
        payloadLength: payload.length,
        payloadPreview: payload.substring(0, 100) + '...'
      });
      
      const mirror = this.getMirror();
      const tx = await mirror.sendMessage(payload, 0n);
      const receipt = await tx.sendAndWaitForReceipt();
      
      console.log('[VaraEth] Initialization transaction confirmed:', {
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber
      });
      
      // Wait for reply with timeout
      const replyListener = await tx.setupReplyListener();
      const replyPromise = replyListener.waitForReply();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Reply timeout after 30 seconds')), 30000);
      });
      
      try {
        const reply = await Promise.race([replyPromise, timeoutPromise]);
        const replyPayload = reply.payload || '0x';
        console.log('[VaraEth] Initialization reply received:', {
          payloadLength: replyPayload.length,
          payloadPreview: replyPayload.substring(0, 100)
        });
        
        // Check if reply indicates an error
        if (replyPayload && replyPayload !== '0x' && replyPayload.length > 2) {
          try {
            const stringDecoded = this.registry.createType('String', this.hexToUint8Array(replyPayload));
            const errorMessage = stringDecoded.toJSON() as string;
            if (errorMessage && errorMessage.length > 0) {
              throw new Error(`Program returned error during initialization: ${errorMessage}`);
            }
          } catch (decodeError) {
            // Not a string error, might be OK
            console.log('[VaraEth] Reply is not an error string, assuming success');
          }
        }
        
        console.log('[VaraEth] Program initialized successfully');
      } catch (timeoutError: any) {
        // Initialization might not return a reply, so timeout is acceptable
        // But verify it actually worked by checking if program is now initialized
        console.warn('[VaraEth] No reply received, but transaction confirmed. Verifying initialization...');
        
        // Wait a bit for state to update
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if program is now initialized
        const isNowInitialized = await this.checkInitialized();
        if (!isNowInitialized) {
          throw new Error(
            'Initialization transaction confirmed but program is still uninitialized. ' +
            'This might mean:\n' +
            '1. The program needs to be initialized during creation (not after)\n' +
            '2. The constructor encoding is incorrect\n' +
            '3. The program needs to be funded with wVARA first\n\n' +
            'Please check the program deployment and try initializing it using the ethexe script: ' +
            'cd ethexe && npm run init'
          );
        }
        console.log('[VaraEth] Program verified as initialized');
      }
    } catch (error: any) {
      console.error('[VaraEth] Initialize error:', error);
      
      // Provide more helpful error message
      if (error.message?.includes('revert') || error.message?.includes('reverted')) {
        throw new Error(
          `Initialization transaction reverted. Possible causes:\n` +
          `1. Program may need to be initialized during creation (not after deployment)\n` +
          `2. Program needs wVARA balance for execution\n` +
          `3. Constructor encoding may be incorrect\n` +
          `4. Program may already be initialized\n\n` +
          `Try:\n` +
          `- Check program balance: https://explorer.hoodi.network/address/${this.programId}\n` +
          `- Initialize using script: cd ethexe && npm run init\n` +
          `- Original error: ${error.message}`
        );
      }
      
      throw error;
    }
  }

  // Encode constructor call: New(settler_role: ActorId, liveness_seconds: u64)
  private encodeConstructor(settlerRole: `0x${string}`, livenessSeconds: bigint): `0x${string}` {
    // Convert settler_role from hex string to ActorId (32 bytes)
    const settlerBytes = this.hexToUint8Array(settlerRole);
    // Ensure it's 32 bytes (pad if needed)
    const settlerActorId = new Uint8Array(32);
    settlerActorId.set(settlerBytes.slice(-32), Math.max(0, 32 - settlerBytes.length));
    
    // Encode constructor name as String
    const constructorNameType = this.registry.createType('String', 'New');
    const nameEncoded = constructorNameType.toU8a();
    
    // Encode arguments as tuple: ([u8;32], u64)
    const argsType = this.registry.createType('([u8;32], u64)', [Array.from(settlerActorId), livenessSeconds]);
    const argsEncoded = argsType.toU8a();
    
    // Combine: constructor name + args
    const fullPayload = new Uint8Array(nameEncoded.length + argsEncoded.length);
    fullPayload.set(nameEncoded, 0);
    fullPayload.set(argsEncoded, nameEncoded.length);
    
    return `0x${this.uint8ArrayToHex(fullPayload)}` as `0x${string}`;
  }

  // Claim payout from a finalized settlement (try injected first for gasless, fallback to classic)
  async claim(basketId: bigint): Promise<bigint> {
    const payload = await this.encodeClaim(basketId);
    
    // Try injected transaction first (gasless, pre-confirmed)
    try {
      return await this.claimInjected(payload);
    } catch (error: any) {
      console.warn('[VaraEth] Injected transaction failed, falling back to classic:', error.message);
      // Fallback to classic transaction (user pays gas)
      return this.claimClassic(payload);
    }
  }

  // Injected transaction for claiming (gasless, pre-confirmed)
  private async claimInjected(payload: `0x${string}`): Promise<bigint> {
    try {
      const api = await this.getApi();
      
      const injected = await api.createInjectedTransaction({
        destination: this.programId,
        payload: payload as `0x${string}`,
        value: 0n,
      });
      
      const result = await injected.sendAndWaitForPromise();
      
      // Check if transaction was rejected
      if (!result || (result as any).status === 'Reject') {
        const reason = (result as any)?.reason || 'Unknown reason';
        throw new Error(`Transaction rejected: ${reason}`);
      }
      
      const replyPayload = (result as any)?.reply?.payload || '0x';
      const response = await this.decodeResponseFromPayload(replyPayload, 'Result<u128, String>');
      
      if ('err' in response) {
        throw new Error(`Failed to claim: ${response.err}`);
      }
      
      return BigInt(response.ok);
    } catch (error: any) {
      console.error('[VaraEth] Injected transaction error:', error);
      throw error;
    }
  }

  // Classic transaction via Mirror (fallback method)
  private async claimClassic(payload: `0x${string}`): Promise<bigint> {
    try {
      const mirror = this.getMirror();
      const tx = await mirror.sendMessage(payload, 0n);
      const receipt = await tx.sendAndWaitForReceipt();
      
      // Wait for reply
      const replyListener = await tx.setupReplyListener();
      const reply = await replyListener.waitForReply();
      const replyPayload = reply.payload || '0x';
      
      // Decode response
      const response = await this.decodeResponseFromPayload(replyPayload, 'Result<u128, String>');
      if ('err' in response) {
        throw new Error(`Failed to claim: ${response.err}`);
      }
      
      return BigInt(response.ok);
    } catch (error: any) {
      console.error('[VaraEth] Claim error:', error);
      throw error;
    }
  }

  // Calculate function selector (first 4 bytes of SHA-256 hash of function signature)
  // Uses Web Crypto API for browser compatibility
  private async getFunctionSelector(signature: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const data = encoder.encode(signature);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    return hashArray.slice(0, 4);
  }

  // Encode/decode helpers - Use sails-js with IDL for proper encoding
  private async encodeCreateBasket(name: string, description: string, items: BasketItem[]): Promise<`0x${string}`> {
    // Use sails-js with IDL for proper encoding (this is the correct way)
    try {
      const sails = await this.getSails();
      if (sails && sails.services?.BasketMarket?.functions?.CreateBasket) {
        const payload = sails.services.BasketMarket.functions.CreateBasket.encodePayload(name, description, items, 'Vara');
        // Convert hex to Uint8Array for logging (browser-compatible)
        const payloadBytes = this.hexToUint8Array(payload);
        console.log('[VaraEth] CreateBasket encoding (via sails-js IDL):', {
          method: 'sails-js IDL',
          payloadHex: payload.substring(0, 100) + '...',
          payloadLength: payload.length,
          firstBytes: Array.from(payloadBytes.slice(0, 20))
        });
        return payload as `0x${string}`;
      } else {
        throw new Error('sails.services.BasketMarket.functions.CreateBasket not found');
      }
    } catch (error) {
      console.error('[VaraEth] Failed to use sails-js encoding:', error);
      // Don't fallback - fail hard so we know encoding is wrong
      throw new Error(`Failed to encode CreateBasket: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private encodeGetBasketCount(): `0x${string}` {
    // GetBasketCount is a query - need to encode: service_name (String) + query_name (String)
    // Format: [service_name (String)] + [query_name (String)]
    const serviceNameType = this.registry.createType('String', 'BasketMarket');
    const serviceEncoded = serviceNameType.toU8a();
    
    const queryNameType = this.registry.createType('String', 'GetBasketCount');
    const queryEncoded = queryNameType.toU8a();
    
    const fullPayload = new Uint8Array(serviceEncoded.length + queryEncoded.length);
    fullPayload.set(serviceEncoded, 0);
    fullPayload.set(queryEncoded, serviceEncoded.length);
    
    return `0x${this.uint8ArrayToHex(fullPayload)}` as `0x${string}`;
  }

  private encodeGetBasket(basketId: bigint): `0x${string}` {
    // Encode u64 basket ID
    const basketIdType = this.registry.createType('u64', basketId);
    const encoded = basketIdType.toU8a();
    return `0x${this.uint8ArrayToHex(encoded)}` as `0x${string}`;
  }

  private async encodeBetOnBasket(basketId: bigint, indexAtCreationBps: number): Promise<`0x${string}`> {
    // Encode service name as String
    const serviceNameType = this.registry.createType('String', 'BasketMarket');
    const serviceEncoded = serviceNameType.toU8a();
    
    // Encode method name as String
    const methodNameType = this.registry.createType('String', 'BetOnBasket');
    const methodEncoded = methodNameType.toU8a();
    
    // Encode arguments as tuple: (u64, u16)
    const basketIdType = this.registry.createType('u64', basketId);
    const indexBpsType = this.registry.createType('u16', indexAtCreationBps);
    const tupleType = this.registry.createType('(u64, u16)', [basketId, indexAtCreationBps]);
    const argsEncoded = tupleType.toU8a();
    
    // Combine: service + method + args
    const fullPayload = new Uint8Array(serviceEncoded.length + methodEncoded.length + argsEncoded.length);
    fullPayload.set(serviceEncoded, 0);
    fullPayload.set(methodEncoded, serviceEncoded.length);
    fullPayload.set(argsEncoded, serviceEncoded.length + methodEncoded.length);
    
    return `0x${this.uint8ArrayToHex(fullPayload)}` as `0x${string}`;
  }

  private encodeGetPositions(userAddress: `0x${string}`): `0x${string}` {
    // Convert address to [u8;32] format and encode
    const addressBytes = this.addressToBytes32(userAddress);
    const addressType = this.registry.createType('[u8;32]', addressBytes);
    const encoded = addressType.toU8a();
    return `0x${this.uint8ArrayToHex(encoded)}` as `0x${string}`;
  }

  private encodeGetSettlement(basketId: bigint): `0x${string}` {
    // Encode u64 basket ID
    const basketIdType = this.registry.createType('u64', basketId);
    const encoded = basketIdType.toU8a();
    return `0x${this.uint8ArrayToHex(encoded)}` as `0x${string}`;
  }

  private async encodeClaim(basketId: bigint): Promise<`0x${string}`> {
    // Encode service name as String
    const serviceNameType = this.registry.createType('String', 'BasketMarket');
    const serviceEncoded = serviceNameType.toU8a();
    
    // Encode method name as String
    const methodNameType = this.registry.createType('String', 'Claim');
    const methodEncoded = methodNameType.toU8a();
    
    // Encode u64 basket ID
    const basketIdType = this.registry.createType('u64', basketId);
    const argsEncoded = basketIdType.toU8a();
    
    // Combine: service + method + args
    const fullPayload = new Uint8Array(serviceEncoded.length + methodEncoded.length + argsEncoded.length);
    fullPayload.set(serviceEncoded, 0);
    fullPayload.set(methodEncoded, serviceEncoded.length);
    fullPayload.set(argsEncoded, serviceEncoded.length + methodEncoded.length);
    
    return `0x${this.uint8ArrayToHex(fullPayload)}` as `0x${string}`;
  }

  private addressToBytes32(address: `0x${string}`): Uint8Array {
    // Convert Ethereum address (20 bytes) to ActorId (32 bytes)
    // Pad with zeros on the left
    const addressBytes = this.hexToUint8Array(address);
    const bytes32 = new Uint8Array(32);
    bytes32.set(addressBytes, 12); // Pad 12 bytes on left
    return bytes32;
  }

  // Decode response from injected transaction reply payload
  private async decodeResponseFromPayload(
    payload: `0x${string}` | string,
    resultType: 'Result<u64, String>' | 'Result<u128, String>' = 'Result<u64, String>'
  ): Promise<{ ok: bigint | string } | { err: string }> {
    // Remove 0x prefix if present and convert to Uint8Array
    const hexString = payload.startsWith('0x') ? payload.slice(2) : payload;
    if (hexString === '' || hexString === '00') {
      throw new Error('Empty or invalid payload');
    }
    
    const bytes = this.hexToUint8Array(hexString);
    
    try {
      // Try to decode as Result type
      const decoded = this.registry.createType(resultType, bytes);
      return decoded.toJSON() as { ok: bigint | string } | { err: string };
    } catch (error: any) {
      // If decoding fails, it might be a raw error string
      // Try decoding as String first
      try {
        const stringDecoded = this.registry.createType('String', bytes);
        const errorMessage = stringDecoded.toJSON() as string;
        console.warn('[VaraEth] Reply is a raw error string, not Result type:', errorMessage);
        return { err: errorMessage };
      } catch (stringError) {
        // If both fail, throw the original error with more context
        console.error('[VaraEth] Failed to decode reply payload:', {
          payloadHex: payload.substring(0, 100),
          payloadLength: bytes.length,
          firstBytes: Array.from(bytes.slice(0, 20)),
          error: error.message
        });
        throw new Error(`Failed to decode reply: ${error.message}. Payload: ${payload.substring(0, 100)}...`);
      }
    }
  }

  private decodeBasket(state: any): Basket {
    const basketType = this.registry.createType('Basket', state);
    const json = basketType.toJSON() as any;
    return json as unknown as Basket;
  }

  private decodePositions(state: any): Position[] {
    const positionsType = this.registry.createType('Vec<Position>', state);
    const json = positionsType.toJSON() as any;
    return json as unknown as Position[];
  }

  private decodeSettlement(state: any): Settlement {
    const settlementType = this.registry.createType('Settlement', state);
    const json = settlementType.toJSON() as any;
    return json as unknown as Settlement;
  }
}

// Factory function
export function createVaraEthBasketMarket(
  ethereumClient: EthereumClient,
  userAddress: `0x${string}`,
  publicClient: PublicClient,
  walletClient: WalletClient,
  programId?: `0x${string}`
): VaraEthBasketMarket {
  const pid = (programId || ENV.VARAETH_PROGRAM_ID || '0x81c8f165db913ec5fbd02618480aaac265eee13b') as `0x${string}`;
  
  if (!pid || pid === '0x') {
    throw new Error('VARAETH_PROGRAM_ID is not set. Please configure VITE_VARAETH_PROGRAM_ID in .env');
  }
  
  console.log('[VaraEth] Creating basket market client:', {
    programId: pid,
    router: ENV.VARAETH_ROUTER,
    rpc: ENV.VARAETH_RPC,
    userAddress
  });
  
  return new VaraEthBasketMarket(ethereumClient, pid, userAddress, publicClient, walletClient);
}
