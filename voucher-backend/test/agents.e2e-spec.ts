import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Keyring } from '@polkadot/api';
import { waitReady } from '@polkadot/wasm-crypto';
import { AppModule } from '../src/app.module';
import { canonicalize } from '../src/gasless/signature.verifier';

/**
 * E2E test exercising the full register → chain → ENS → lookup flow against
 * the configured mainnet/staging node and Namespace API.
 *
 * REQUIRED ENV (in voucher-backend/.env, never commit):
 *   NODE_URL                       — Vara RPC (e.g. wss://rpc.vara.network)
 *   VOUCHER_ACCOUNT                — funded Vara seed (// or 0x or mnemonic)
 *   BASKET_MARKET_PROGRAM_ID       — 0x… BasketMarket program id
 *   NAMESPACE_API_KEY              — Namespace mainnet key (rotated)
 *   NAMESPACE_MODE=mainnet
 *   AGENT_PARENT_NAME=polybaskets.eth
 *   POLYBASKETS_OWNER_EVM          — EVM owner of polybaskets.eth
 *   DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME — Postgres
 *
 * To run:
 *   cd voucher-backend && pnpm test test/agents.e2e-spec.ts --testTimeout 90000
 *
 * Default test runs SKIP this file because jest.config.ts sets rootDir:'src',
 * so the test/ directory is never scanned. You can still pass an explicit
 * path to jest to run this test manually against real infrastructure.
 *
 * WARNING: This test creates a real subname under polybaskets.eth on mainnet.
 * Review cleanup requirements before running against production. The label
 * is derived from Date.now() to avoid collisions between runs.
 */
describe('Agents E2E (mainnet)', () => {
  let app: INestApplication;
  let pair: ReturnType<Keyring['addFromUri']>;

  beforeAll(async () => {
    await waitReady();
    pair = new Keyring({ type: 'sr25519', ss58Format: 137 }).addFromUri(
      `//Test${Date.now()}`,
    );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('register → forward lookup → reverse lookup', async () => {
    // Label must be lowercase alphanumeric, max 16 chars to fit ENS constraints.
    const label = `e2e${Date.now()}`.slice(0, 16).toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      ss58: pair.address,
      action: 'register' as const,
      label,
      nonce: `${Date.now()}-${Math.random()}`,
      issuedAt: now,
      expiresAt: now + 600,
      audience: 'polybaskets.eth' as const,
    };
    const sig = pair.sign(canonicalize(payload));

    // Step 1: register the agent
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/register')
      .send({
        payload,
        signature: '0x' + Buffer.from(sig).toString('hex'),
      })
      .expect(200);

    expect(res.body.label).toBe(label);

    // Allow chain finalization + ENS subname creation to complete.
    // Chain block time ~2s, ENS offchain propagation varies; 12s is conservative.
    await new Promise((r) => setTimeout(r, 12_000));

    // Step 2: forward lookup — resolve by label
    const fwd = await request(app.getHttpServer())
      .get(`/api/v1/agents/by-label/${label}`)
      .expect(200);

    expect(fwd.body?.label).toBe(label);

    // Step 3: reverse lookup — resolve by Vara ss58 address
    const rev = await request(app.getHttpServer())
      .get(`/api/v1/agents/by-address/${pair.address}`)
      .expect(200);

    expect(rev.body?.label).toBe(label);
  }, 60_000);
});
