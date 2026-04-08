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
      '0x43b9703636ea9eda9e25398962adb6c19cba9a4a20fa6b3dd2e66a244ff6d04a',
    varaToIssue: 3, // 3 VARA per voucher (covers ~7 tx/day)
    duration: 86400, // 24 hours
    oneTime: false,
  },
  {
    name: 'BetToken',
    address:
      '0x16aa2dff1365dd04733306a39205cf1bc2a730d8b8d488d0467b98cfdf2a88c1',
    varaToIssue: 3,
    duration: 86400,
    oneTime: false,
  },
  {
    name: 'BetLane',
    address:
      '0x501921de35cbd677c724449761b8477cf8fbb41e603deab80f68565943def59a',
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
