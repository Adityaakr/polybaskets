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
      '0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2',
    weight: 1,
    duration: 86400, // 24 hours
    oneTime: false,
  },
  {
    name: 'BetToken',
    address:
      '0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc',
    weight: 1,
    duration: 86400,
    oneTime: false,
  },
  {
    name: 'BetLane',
    address:
      '0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc',
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
