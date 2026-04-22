import { config } from 'dotenv';

config();

const required = (name: string): string => {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is not set`);
  return val;
};

export default () => ({
  port: Number(process.env.PORT || '3001'),
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    name: required('DB_NAME'),
  },
  nodeUrl: required('NODE_URL'),
  voucherAccount: required('VOUCHER_ACCOUNT'),
  // Per-tranche VARA amount added on issue() and every hourly top-up.
  hourlyTrancheVara: Number(process.env.HOURLY_TRANCHE_VARA || '500'),
  // Max tranches per IP per UTC day (second abuse gate — the only aggregate limit).
  // 40 × 500 = 20,000 VARA/day/IP at current tranche size.
  perIpTranchesPerDay: Number(process.env.PER_IP_TRANCHES_PER_DAY || '40'),
  // Seconds between eligible top-ups per wallet.
  trancheIntervalSec: Number(process.env.TRANCHE_INTERVAL_SEC || '3600'),
  // Voucher validity duration. Extended by trancheDurationSec on every top-up
  // (sliding window — voucher expires only if user abandons ≥24h).
  trancheDurationSec: Number(process.env.TRANCHE_DURATION_SEC || '86400'),
  infoApiKey: process.env.INFO_API_KEY || '',
});
