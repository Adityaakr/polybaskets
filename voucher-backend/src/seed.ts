import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import {
  GaslessProgram,
  GaslessProgramStatus,
} from './entities/gasless-program.entity';
import { Voucher } from './entities/voucher.entity';

config();

/**
 * PolyBaskets program whitelist for the voucher backend.
 *
 * Season 2 (Path B): all three programs share a single voucher per account.
 * The first POST of a UTC day funds the voucher to `DAILY_VARA_CAP` (env var,
 * default 2000). Subsequent same-day POSTs for additional programs append to
 * the same voucher without re-funding.
 *
 * `varaToIssue` and `weight` on each row are retained for schema compatibility
 * but are no longer read by `gasless.service.ts` in Path B — the dailyCap is
 * applied uniformly across all programs.
 */
const PROGRAMS = [
  {
    name: 'BasketMarket',
    address:
      '0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2',
    weight: 1,
    duration: 86400, // 24h
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
    weight: 1,
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

  const dailyCap = Number(process.env.DAILY_VARA_CAP || '2000');

  for (const p of PROGRAMS) {
    // varaToIssue is inactive in Path B (kept for schema compat).
    // Display value tracks dailyCap so the DB state is self-documenting.
    const varaToIssue = dailyCap;
    const existing = await repo.findOneBy({ address: p.address });

    if (existing) {
      existing.weight = p.weight;
      existing.varaToIssue = varaToIssue;
      existing.duration = p.duration;
      await repo.save(existing);
      console.log(`[update] ${p.name} ${p.address.slice(0, 12)}... (cap=${dailyCap} VARA)`);
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
    console.log(`[seed] ${p.name} ${p.address.slice(0, 12)}... (cap=${dailyCap} VARA)`);
  }

  console.log('Seed complete.');
  await ds.destroy();
}

seed().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
