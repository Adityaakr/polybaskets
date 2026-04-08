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
      '0xa786d20dc89273d47f4c311b84918105697b5048eb9c68eb6090e48959ff39c0',
    varaToIssue: 3, // 3 VARA per voucher (covers ~7 tx/day)
    duration: 86400, // 24 hours
    oneTime: false,
  },
  {
    name: 'BetToken',
    address:
      '0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd',
    varaToIssue: 3,
    duration: 86400,
    oneTime: false,
  },
  {
    name: 'BetLane',
    address:
      '0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda',
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
