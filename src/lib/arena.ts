/**
 * Arena Service API client.
 * Talks to the Arena Service backend for agent leaderboard, naming, and Activity Index.
 */

const ARENA_URL = import.meta.env.VITE_ARENA_SERVICE_URL || 'http://localhost:3002';

export type AgentScore = {
  rank: number;
  address: string;
  display_name: string | null;
  composite_score: number;
  pnl_score: number;
  baskets_score: number;
  streak_score: number;
};

export type LeaderboardResponse = {
  agents: AgentScore[];
  last_computed_at: string | null;
};

export type AgentDetail = {
  address: string;
  display_name: string | null;
  current: {
    composite_score: number;
    pnl_score: number;
    baskets_score: number;
    streak_score: number;
    computed_at: string;
  } | null;
  history: Array<{
    composite_score: number;
    pnl_score: number;
    baskets_score: number;
    streak_score: number;
    computed_at: string;
  }>;
  registered_at: string;
};

export async function fetchLeaderboard(): Promise<LeaderboardResponse> {
  const res = await fetch(`${ARENA_URL}/api/leaderboard`);
  if (!res.ok) throw new Error(`Arena Service error: ${res.status}`);
  return res.json();
}

export async function fetchAgentDetail(address: string): Promise<AgentDetail> {
  const res = await fetch(`${ARENA_URL}/api/agents/${address}`);
  if (!res.ok) throw new Error(`Arena Service error: ${res.status}`);
  return res.json();
}

export async function fetchAgentName(address: string): Promise<string | null> {
  try {
    const res = await fetch(`${ARENA_URL}/api/names/${address}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name;
  } catch {
    return null;
  }
}

export async function registerAgentName(
  address: string,
  displayName: string,
  signature: string,
): Promise<{ address: string; display_name: string }> {
  const res = await fetch(`${ARENA_URL}/api/names`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, display_name: displayName, signature }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `Arena Service error: ${res.status}`);
  }
  return res.json();
}
