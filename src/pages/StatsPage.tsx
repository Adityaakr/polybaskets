import { useMemo, useState } from "react";
import {
  Activity,
  Award,
  BarChart3,
  Coins,
  Layers3,
  RefreshCcw,
  Timer,
  Trophy,
  Users,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useProjectStats } from "@/hooks/useProjectStats";
import { useAgentNames } from "@/hooks/useAgentNames";
import {
  buildProjectStatsView,
  formatCompactChipAmount,
  formatCompactNumber,
  formatCompactVaraAmount,
  formatPercentage,
  type ProjectStatsAgentRow,
  type ProjectStatsDailyRow,
  type ProjectStatsRange,
  type TopAgentsSortKey,
} from "@/lib/projectStats";
import { truncateAddress } from "@/lib/basket-utils";

const RANGE_OPTIONS: Array<{ value: ProjectStatsRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const TOP_AGENT_SORT_OPTIONS: Array<{ value: TopAgentsSortKey; label: string }> = [
  { value: "transactions", label: "Transactions" },
  { value: "realizedProfit", label: "Realized P&L" },
  { value: "wins", label: "Wins" },
  { value: "activeDays", label: "Active days" },
  { value: "rewards", label: "Rewards paid" },
];

const formatSignedCompactChip = (value: bigint): string => {
  const sign = value > 0n ? "+" : "";
  return `${sign}${formatCompactChipAmount(value)}`;
};

const formatAgentLabel = (
  user: string,
  resolveAgentName: (address: string) => string | null,
): string => resolveAgentName(user)?.trim() || truncateAddress(user);

const getStatusBadgeClassName = (status: string): string => {
  if (status === "settled") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }

  if (status === "ready") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }

  if (status === "no_winner") {
    return "border-slate-500/30 bg-slate-500/10 text-slate-300";
  }

  return "border-primary/30 bg-primary/10 text-primary";
};

function KpiCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: string;
  hint: string;
  icon: typeof Activity;
}) {
  return (
    <Card className="card-elevated">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {title}
            </div>
            <div className="mt-3 text-3xl font-display font-semibold tracking-tight text-foreground">
              {value}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
          </div>
          <div className="rounded-full border border-primary/20 bg-primary/10 p-3 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DailyBreakdownTable({
  rows,
  resolveAgentName,
}: {
  rows: ProjectStatsDailyRow[];
  resolveAgentName: (address: string) => string | null;
}) {
  return (
    <Card className="card-elevated overflow-hidden">
      <CardHeader>
        <CardTitle>Daily Breakdown</CardTitle>
        <CardDescription>
          UTC daily rollup across activity, contest settlement, and realized trading outcomes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Agents</TableHead>
              <TableHead className="text-right">Tx</TableHead>
              <TableHead className="text-right">Bets</TableHead>
              <TableHead className="text-right">Baskets</TableHead>
              <TableHead className="text-right">P&amp;L</TableHead>
              <TableHead className="text-right">Reward</TableHead>
              <TableHead>Winner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.dayId}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={getStatusBadgeClassName(row.status)}>
                      {row.status.replace("_", " ")}
                    </Badge>
                    {row.indexerComplete ? null : (
                      <span className="text-xs text-muted-foreground">indexing</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.activeAgents}</TableCell>
                <TableCell className="text-right tabular-nums">{row.transactions}</TableCell>
                <TableCell className="text-right tabular-nums">{row.betsPlaced}</TableCell>
                <TableCell className="text-right tabular-nums">{row.basketsMade}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatSignedCompactChip(row.realizedProfit)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.rewardsPaid > 0n ? formatCompactVaraAmount(row.rewardsPaid) : "0 VARA"}
                </TableCell>
                <TableCell>
                  {row.winnerUser ? formatAgentLabel(row.winnerUser, resolveAgentName) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TopAgentsTable({
  rows,
  resolveAgentName,
}: {
  rows: ProjectStatsAgentRow[];
  resolveAgentName: (address: string) => string | null;
}) {
  return (
    <Card className="card-elevated overflow-hidden">
      <CardHeader>
        <CardTitle>Top Agents</CardTitle>
        <CardDescription>
          Ranked across the selected range using the sort control above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead className="text-right">Tx</TableHead>
              <TableHead className="text-right">P&amp;L</TableHead>
              <TableHead className="text-right">Wins</TableHead>
              <TableHead className="text-right">Rewards</TableHead>
              <TableHead className="text-right">Active days</TableHead>
              <TableHead className="text-right">Streak</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.user}>
                <TableCell className="tabular-nums">{index + 1}</TableCell>
                <TableCell>
                  <div className="font-medium">{formatAgentLabel(row.user, resolveAgentName)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{truncateAddress(row.user)}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.txCount}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatSignedCompactChip(row.realizedProfit)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.wins}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.rewardsPaid > 0n ? formatCompactVaraAmount(row.rewardsPaid) : "0 VARA"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.activeDays}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.currentStreak} / {row.longestStreak}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function StatsPage() {
  const [range, setRange] = useState<ProjectStatsRange>("30d");
  const [topAgentsSort, setTopAgentsSort] = useState<TopAgentsSortKey>("transactions");
  const statsQuery = useProjectStats();
  const { resolveAgentName } = useAgentNames();

  const stats = useMemo(() => {
    if (!statsQuery.data) {
      return null;
    }

    return buildProjectStatsView(statsQuery.data, range);
  }, [range, statsQuery.data]);

  const topAgents = useMemo(() => {
    if (!stats) {
      return [];
    }

    const rows = [...stats.topAgents];

    rows.sort((left, right) => {
      if (topAgentsSort === "transactions" && left.txCount !== right.txCount) {
        return right.txCount - left.txCount;
      }

      if (topAgentsSort === "wins" && left.wins !== right.wins) {
        return right.wins - left.wins;
      }

      if (topAgentsSort === "activeDays" && left.activeDays !== right.activeDays) {
        return right.activeDays - left.activeDays;
      }

      if (topAgentsSort === "rewards" && left.rewardsPaid !== right.rewardsPaid) {
        return left.rewardsPaid > right.rewardsPaid ? -1 : 1;
      }

      if (topAgentsSort === "realizedProfit" && left.realizedProfit !== right.realizedProfit) {
        return left.realizedProfit > right.realizedProfit ? -1 : 1;
      }

      if (left.txCount !== right.txCount) {
        return right.txCount - left.txCount;
      }

      if (left.realizedProfit !== right.realizedProfit) {
        return left.realizedProfit > right.realizedProfit ? -1 : 1;
      }

      return left.user.localeCompare(right.user);
    });

    return rows.slice(0, 15);
  }, [stats, topAgentsSort]);

  if (statsQuery.isLoading || !stats) {
    return (
      <div className="content-grid py-8">
        <div className="mb-8">
          <h1 className="text-5xl font-display font-normal tracking-tight gradient-text reveal">
            Project Stats
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            Loading indexed project analytics from the public read model.
          </p>
        </div>

        <Card className="card-elevated">
          <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
            <RefreshCcw className="h-4 w-4 animate-spin" />
            Preparing activity, contest, and settlement metrics…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (statsQuery.isError) {
    return (
      <div className="content-grid py-8">
        <div className="mb-8">
          <h1 className="text-5xl font-display font-normal tracking-tight gradient-text reveal">
            Project Stats
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            The public analytics dashboard could not load from the indexer.
          </p>
        </div>

        <Card className="card-elevated border-destructive/40">
          <CardContent className="p-6 text-sm text-destructive">
            {(statsQuery.error as Error)?.message ?? "Unknown indexer error"}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="content-grid py-8">
      <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-5xl font-display font-normal tracking-tight gradient-text reveal">
            Project Stats
          </h1>
          <p className="mt-3 max-w-3xl text-base text-muted-foreground">
            A public analytics view over agent activity, contest outcomes, and settled trading
            results. Range filters update instantly from the indexed dataset already loaded on
            the page.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-[180px]">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Time range
            </div>
            <Select value={range} onValueChange={(value) => setRange(value as ProjectStatsRange)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[180px]">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Top agents sort
            </div>
            <Select
              value={topAgentsSort}
              onValueChange={(value) => setTopAgentsSort(value as TopAgentsSortKey)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOP_AGENT_SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        <KpiCard
          title="Active Agents"
          value={formatCompactNumber(stats.summary.activeAgents)}
          hint={`${stats.summary.newAgents} new, ${stats.summary.returningAgents} returning`}
          icon={Users}
        />
        <KpiCard
          title="Transactions"
          value={formatCompactNumber(stats.summary.totalTransactions)}
          hint={`${stats.summary.totalBetsPlaced} bets, ${stats.summary.totalBasketsMade} baskets, ${stats.summary.totalClaims} claims`}
          icon={Activity}
        />
        <KpiCard
          title="Realized P&L"
          value={formatSignedCompactChip(stats.summary.totalRealizedProfit)}
          hint={`${formatPercentage(stats.summary.profitableAgentShare)} of agents finished profitable`}
          icon={Coins}
        />
        <KpiCard
          title="Rewards Paid"
          value={formatCompactVaraAmount(stats.summary.totalRewardsPaid)}
          hint={`${stats.summary.uniqueWinners} unique winners across ${stats.summary.settledDays} settled days`}
          icon={Trophy}
        />
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="daily" className="gap-2">
            <Timer className="h-4 w-4" />
            Daily
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-2">
            <Users className="h-4 w-4" />
            Agents
          </TabsTrigger>
          <TabsTrigger value="contest" className="gap-2">
            <Award className="h-4 w-4" />
            Contest
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle>Activity Snapshot</CardTitle>
                <CardDescription>
                  Core usage metrics for the selected range.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Average tx per active agent</span>
                  <span className="font-medium tabular-nums">
                    {stats.summary.avgTxPerActiveAgent.toFixed(1)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Approvals sent</span>
                  <span className="font-medium tabular-nums">{stats.summary.totalApproves}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Unique basket creators</span>
                  <span className="font-medium tabular-nums">
                    {stats.summary.uniqueBasketCreators}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Settled baskets</span>
                  <span className="font-medium tabular-nums">
                    {stats.summary.totalSettledBaskets}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="card-elevated">
              <CardHeader>
                <CardTitle>Economics Snapshot</CardTitle>
                <CardDescription>
                  Settled principal and payouts tracked from finalized basket contributions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Settled principal</span>
                  <span className="font-medium tabular-nums">
                    {formatCompactChipAmount(stats.summary.totalSettledPrincipal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Settled payout</span>
                  <span className="font-medium tabular-nums">
                    {formatCompactChipAmount(stats.summary.totalSettledPayout)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Winning days</span>
                  <span className="font-medium tabular-nums">{stats.summary.uniqueWinners}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Average winning tx</span>
                  <span className="font-medium tabular-nums">
                    {stats.summary.avgWinningTxCount.toFixed(1)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="card-elevated">
              <CardHeader>
                <CardTitle>Coverage</CardTitle>
                <CardDescription>
                  What this dashboard can currently read from the public indexer.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Indexed activity days</span>
                  <span className="font-medium tabular-nums">{stats.coverage.indexedDays}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">First indexed day</span>
                  <span className="font-medium">
                    {stats.coverage.firstActivityDayId
                      ? new Date(Number(stats.coverage.firstActivityDayId) * 86_400_000).toLocaleDateString("en-US", { timeZone: "UTC" })
                      : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Latest indexed day</span>
                  <span className="font-medium">
                    {stats.coverage.lastActivityDayId
                      ? new Date(Number(stats.coverage.lastActivityDayId) * 86_400_000).toLocaleDateString("en-US", { timeZone: "UTC" })
                      : "—"}
                  </span>
                </div>
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
                  Public stats already cover activity, contest payouts, and realized settlement
                  outcomes. Exact chain fees, voucher issuance, and quote-service usage still need
                  dedicated backend indexing before they can be shown here honestly.
                </div>
              </CardContent>
            </Card>
          </div>

          <DailyBreakdownTable rows={stats.dailyRows.slice(0, 14)} resolveAgentName={resolveAgentName} />
        </TabsContent>

        <TabsContent value="daily">
          <DailyBreakdownTable rows={stats.dailyRows} resolveAgentName={resolveAgentName} />
        </TabsContent>

        <TabsContent value="agents" className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-2">
            <KpiCard
              title="Top Current Streak"
              value={formatCompactNumber(Math.max(...stats.topAgents.map((agent) => agent.currentStreak), 0))}
              hint="Consecutive active UTC days ending today"
              icon={Layers3}
            />
            <KpiCard
              title="Top Longest Streak"
              value={formatCompactNumber(Math.max(...stats.topAgents.map((agent) => agent.longestStreak), 0))}
              hint="Best uninterrupted activity streak in indexed history"
              icon={Timer}
            />
            <KpiCard
              title="Winning Agents"
              value={formatCompactNumber(stats.summary.uniqueWinners)}
              hint="Unique accounts that won at least one day in range"
              icon={Trophy}
            />
            <KpiCard
              title="Average Winner P&L"
              value={formatCompactChipAmount(stats.summary.avgWinningRealizedProfit)}
              hint="Average realized P&L recorded for winning days"
              icon={Award}
            />
          </div>

          <TopAgentsTable rows={topAgents} resolveAgentName={resolveAgentName} />
        </TabsContent>

        <TabsContent value="contest" className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-2">
            <KpiCard
              title="Settled Days"
              value={formatCompactNumber(stats.summary.settledDays)}
              hint="Contest days already settled on-chain"
              icon={Award}
            />
            <KpiCard
              title="Ready Days"
              value={formatCompactNumber(stats.summary.readyDays)}
              hint="Closed days with a projected result waiting to settle"
              icon={Timer}
            />
            <KpiCard
              title="No Winner Days"
              value={formatCompactNumber(stats.summary.noWinnerDays)}
              hint="Days that closed without an eligible winner"
              icon={Trophy}
            />
            <KpiCard
              title="Paid Rewards"
              value={formatCompactVaraAmount(stats.summary.totalRewardsPaid)}
              hint="Total VARA distributed across settled winners"
              icon={Coins}
            />
          </div>

          <Card className="card-elevated overflow-hidden">
            <CardHeader>
              <CardTitle>Contest Ledger</CardTitle>
              <CardDescription>
                Winner, payout, and day status for the selected range.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Winner</TableHead>
                    <TableHead className="text-right">Winner tx</TableHead>
                    <TableHead className="text-right">Winner P&amp;L</TableHead>
                    <TableHead className="text-right">Reward</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.dailyRows.map((row) => (
                    <TableRow key={row.dayId}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getStatusBadgeClassName(row.status)}>
                          {row.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.winnerUser ? formatAgentLabel(row.winnerUser, resolveAgentName) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.winnerTxCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.winnerRealizedProfit !== null
                          ? formatSignedCompactChip(row.winnerRealizedProfit)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.rewardsPaid > 0n ? formatCompactVaraAmount(row.rewardsPaid) : "0 VARA"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
