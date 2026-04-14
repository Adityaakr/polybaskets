import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import {
  GaslessProgram,
  GaslessProgramStatus,
} from './entities/gasless-program.entity';
import { Voucher } from './entities/voucher.entity';

config();

// PolyBaskets program IDs
// Weights determine proportional share of DAILY_VARA_CAP (default 100 VARA).
// Heavier programs (more gas per tx) get higher weight.
//   BasketMarket: CreateBasket ~2-3B gas (~0.3 VARA/tx)  → weight 1
//   BetToken:     Claim/Approve ~2B gas (~0.2 VARA/tx)   → weight 1
//   BetLane:      PlaceBet ~38B gas (~3.8 VARA/tx)        → weight 8
// With cap=100: BasketMarket=10, BetToken=10, BetLane=80
const PROGRAMS = [
  {
    name: 'BasketMarket',
    address:
      '0x702395d43248eaa5f1fd4d9eadadc75b0fb1c7c5ae9ea20bf31375fd4358f403',
    weight: 1,
    duration: 86400, // 24 hours
    oneTime: false,
  },
  {
    name: 'BetToken',
    address:
      '0x41be634b690ecde3d79f63ea2db9834b8570a6d4abb3c0be47af3947e3129ece',
    weight: 1,
    duration: 86400,
    oneTime: false,
  },
  {
    name: 'BetLane',
    address:
      '0xf5aa436669bb3fc97c1675d06949592e8617f889cbd055451f321113b17bb564',
    weight: 8,
    duration: 86400,
    oneTime: false,
  },
];

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [GaslessProgram, Voucher],
    synchronize: true,
  });

  await ds.initialize();
  const repo = ds.getRepository(GaslessProgram);

  const dailyCap = Number(process.env.DAILY_VARA_CAP || '100');
  const totalWeight = PROGRAMS.reduce((sum, p) => sum + p.weight, 0);

  for (const p of PROGRAMS) {
    const varaToIssue = Math.max(Math.floor(dailyCap * p.weight / totalWeight), 1);
    const existing = await repo.findOneBy({ address: p.address });

    if (existing) {
      existing.weight = p.weight;
      existing.varaToIssue = varaToIssue;
      existing.duration = p.duration;
      await repo.save(existing);
      console.log(`[update] ${p.name} weight=${p.weight} → ${varaToIssue} VARA (${p.address.slice(0, 12)}...)`);
      continue;
    }

    await repo.save({
      name: p.name,
      address: p.address,
      varaToIssue,
      weight: p.weight,
      duration: p.duration,
      status: GaslessProgramStatus.Enabled,
      oneTime: p.oneTime,
      createdAt: new Date(),
    });
    console.log(`[seed] ${p.name} weight=${p.weight} → ${varaToIssue} VARA (${p.address.slice(0, 12)}...)`);
  }

  console.log('Seed complete.');
  await ds.destroy();
}

seed().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
