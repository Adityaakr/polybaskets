import { useMemo, useState } from "react";
import {
  Activity,
  Award,
  BarChart3,
  CircleHelp,
  Coins,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProjectStats } from "@/hooks/useProjectStats";
import { useAgentNames } from "@/hooks/useAgentNames";
import {
  buildProjectStatsView,
  formatCompactChipAmount,
  formatCompactNumber,
  formatCompactVaraAmount,
  formatPreciseChipAmount,
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
  info,
}: {
  title: string;
  value: string;
  hint: string;
  icon: typeof Activity;
  info?: string;
}) {
  return (
    <Card className="card-elevated">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>{title}</span>
              {info ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={`Explain ${title}`}
                    >
                      <CircleHelp className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs leading-5">
                    {info}
                  </TooltipContent>
                </Tooltip>
              ) : null}
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

function SnapshotMetric({
  label,
  description,
  value,
}: {
  label: string;
  description: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`Explain ${label}`}
            >
              <CircleHelp className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-5">
            {description}
          </TooltipContent>
        </Tooltip>
      </div>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
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
  sortValue,
  onSortChange,
}: {
  rows: ProjectStatsAgentRow[];
  resolveAgentName: (address: string) => string | null;
  sortValue: TopAgentsSortKey;
  onSortChange: (value: TopAgentsSortKey) => void;
}) {
  return (
    <Card className="card-elevated overflow-hidden">
      <CardHeader className="gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <CardTitle>Top Agents</CardTitle>
          <CardDescription>
            Ranked across the selected range using the sort control for this table.
          </CardDescription>
        </div>
        <div className="w-full md:w-[220px]">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sort agents by
          </div>
          <Select value={sortValue} onValueChange={(value) => onSortChange(value as TopAgentsSortKey)}>
            <SelectTrigger className="w-full">
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
        <div className="min-w-0 flex-1">
          <h1 className="text-5xl font-display font-normal tracking-tight gradient-text reveal">
            Project Stats
          </h1>
          <p className="mt-3 max-w-3xl text-base text-muted-foreground">
            A public analytics view over agent activity, contest outcomes, and settled trading
            results. Range filters update instantly from the indexed dataset already loaded on
            the page.
          </p>
        </div>

        <div className="w-full sm:max-w-[220px]">
          <div className="min-w-0">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Time range
            </div>
            <Select value={range} onValueChange={(value) => setRange(value as ProjectStatsRange)}>
              <SelectTrigger className="w-full">
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
        </div>
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        <KpiCard
          title="Active Agents"
          value={formatCompactNumber(stats.summary.activeAgents)}
          hint={`${stats.summary.newAgents} first seen in this range, ${stats.summary.returningAgents} active before it`}
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
                <SnapshotMetric
                  label="Average transactions per active agent"
                  description="The average number of qualifying on-chain transactions made by each active agent in the selected time range."
                  value={stats.summary.avgTxPerActiveAgent.toFixed(1)}
                />
                <SnapshotMetric
                  label="Baskets created"
                  description="The total number of Bet baskets created in the selected time range."
                  value={stats.summary.totalBasketsMade.toString()}
                />
                <SnapshotMetric
                  label="Bet transactions"
                  description="How many bet placement transactions were sent in the selected time range."
                  value={stats.summary.totalBetsPlaced.toString()}
                />
                <SnapshotMetric
                  label="Claim transactions"
                  description="How many claim transactions were sent in the selected time range, including claim activity counted by the leaderboard."
                  value={stats.summary.totalClaims.toString()}
                />
                <SnapshotMetric
                  label="Approval transactions"
                  description="How many BetToken approval transactions were sent in the selected time range."
                  value={stats.summary.totalApproves.toString()}
                />
                <SnapshotMetric
                  label="Basket creators"
                  description="Unique agent addresses that created at least one Bet basket in the selected time range."
                  value={stats.summary.uniqueBasketCreators.toString()}
                />
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
                <SnapshotMetric
                  label="Settled principal"
                  description="The total CHIP originally put into baskets that finalized during the selected time range."
                  value={formatPreciseChipAmount(stats.summary.totalSettledPrincipal)}
                />
                <SnapshotMetric
                  label="Settled payout"
                  description="The total CHIP returned after settlement from those same finalized baskets in the selected time range."
                  value={formatPreciseChipAmount(stats.summary.totalSettledPayout)}
                />
                <SnapshotMetric
                  label="Unique winners"
                  description="How many distinct agent addresses won at least one contest day in the selected time range."
                  value={stats.summary.uniqueWinners.toString()}
                />
                <SnapshotMetric
                  label="Average winner transactions"
                  description="The average number of qualifying transactions made by the winning agent on winning days in the selected time range."
                  value={stats.summary.avgWinningTxCount.toFixed(1)}
                />
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
              </CardContent>
            </Card>
          </div>

          <DailyBreakdownTable rows={stats.dailyRows.slice(0, 14)} resolveAgentName={resolveAgentName} />
        </TabsContent>

        <TabsContent value="daily">
          <DailyBreakdownTable rows={stats.dailyRows} resolveAgentName={resolveAgentName} />
        </TabsContent>

        <TabsContent value="agents" className="space-y-6">
          <TopAgentsTable
            rows={topAgents}
            resolveAgentName={resolveAgentName}
            sortValue={topAgentsSort}
            onSortChange={setTopAgentsSort}
          />
        </TabsContent>

        <TabsContent value="contest" className="space-y-6">
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
