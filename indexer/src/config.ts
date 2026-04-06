import { HexString } from "@gear-js/api";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] || fallback;
  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
};

const resolveFromCwd = (relativePath: string): string =>
  path.resolve(process.cwd(), relativePath);

const parseOrigins = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const DAY_MS = 86_400_000n;

export const config = {
  archiveUrl: getEnv(
    "VARA_ARCHIVE_URL",
    "https://v2.archive.subsquid.io/network/vara-testnet"
  ),
  rpcUrl: getEnv("VARA_RPC_URL", "wss://testnet-archive.vara.network"),
  rateLimit: Number(getEnv("VARA_RPC_RATE_LIMIT", "20")),
  fromBlock: Number(getEnv("VARA_FROM_BLOCK", "0")),
  gqlPort: Number(getEnv("INDEXER_GQL_PORT", getEnv("GQL_PORT", "4350"))),
  frontendOrigins: parseOrigins(
    getEnv(
      "FRONTEND_URLS",
      "http://localhost:8080,http://127.0.0.1:8080,http://localhost:3000,http://127.0.0.1:3000"
    )
  ),
  databaseUrl: process.env.DATABASE_URL,
  dbHost: getEnv("DB_HOST", "localhost"),
  dbPort: Number(getEnv("DB_PORT", "5432")),
  dbUser: getEnv("DB_USER", "postgres"),
  dbPass: getEnv("DB_PASS", "postgres"),
  dbName: getEnv("DB_NAME", "polybaskets_indexer"),
  basketMarketProgramId: getEnv("BASKET_MARKET_PROGRAM_ID") as HexString,
  betLaneProgramId: getEnv("BET_LANE_PROGRAM_ID") as HexString,
  dailyContestProgramId: getEnv("DAILY_CONTEST_PROGRAM_ID") as HexString,
  basketMarketIdlPath: getEnv(
    "BASKET_MARKET_IDL_PATH",
    resolveFromCwd("../program/polymarket-mirror.idl")
  ),
  betLaneIdlPath: getEnv(
    "BET_LANE_IDL_PATH",
    resolveFromCwd("../bet-lane/client/bet_lane_client.idl")
  ),
  dailyContestIdlPath: getEnv(
    "DAILY_CONTEST_IDL_PATH",
    resolveFromCwd("../daily-contest/daily-contest.idl")
  ),
  settlementGracePeriodMs: BigInt(
    getEnv("CONTEST_GRACE_PERIOD_MS", "1800000")
  ),
};

export const sourceOfTruth = {
  basketMarket: "basket metadata + settlement finalization day",
  betLane: "CHIP positions and payout formula",
  dailyContest: "final settled day result",
  indexer: "projected aggregates only",
} as const;

export const emptyDayPolicy = "settle_no_winner" as const;
