import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import {
  GaslessProgram,
  GaslessProgramStatus,
} from './entities/gasless-program.entity';
import { Voucher } from './entities/voucher.entity';

config();

// PolyBaskets program IDs (update with mainnet addresses after deploy)
const PROGRAMS = [
  {
    name: 'BasketMarket',
    address:
      '0x4d47cb784a0b1e3788181a6cedb52db11aad0cef4268848e612670f7d950f089',
    varaToIssue: 3, // 3 VARA per voucher (covers ~7 tx/day)
    duration: 86400, // 24 hours
    oneTime: false,
  },
  {
    name: 'BetToken',
    address:
      '0x0a54e06ac29344f127d90b669f4fcd9de86efa4a67c3b8568f6182cf203d4294',
    varaToIssue: 3,
    duration: 86400,
    oneTime: false,
  },
  {
    name: 'BetLane',
    address:
      '0x1764868fba789527b9ded67a8bd0052517ceb308e7b2f08b9c7cf85efbed5dbc',
    varaToIssue: 3,
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

  for (const p of PROGRAMS) {
    const existing = await repo.findOneBy({ address: p.address });
    if (existing) {
      console.log(`[skip] ${p.name} already exists (${p.address.slice(0, 12)}...)`);
      continue;
    }

    await repo.save({
      name: p.name,
      address: p.address,
      varaToIssue: p.varaToIssue,
      duration: p.duration,
      status: GaslessProgramStatus.Enabled,
      oneTime: p.oneTime,
      createdAt: new Date(),
    });
    console.log(`[seed] ${p.name} added (${p.address.slice(0, 12)}...)`);
  }

  console.log('Seed complete.');
  await ds.destroy();
}

seed().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
