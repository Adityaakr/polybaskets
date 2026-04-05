const getEnv = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
};

export const config = {
  pollIntervalMs: Number(getEnv("CONTEST_BOT_POLL_INTERVAL_MS", "30000")),
  dailyContestProgramId: getEnv("DAILY_CONTEST_PROGRAM_ID"),
  graphqlEndpoint: getEnv("INDEXER_GRAPHQL_ENDPOINT", "http://localhost:4350/graphql"),
  varaRpcUrl: getEnv("VARA_RPC_URL", "wss://testnet.vara.network"),
  settlerSeed: getEnv("SETTLER_SEED", "//Alice"),
};

export const DAY_MS = 86_400_000n;
