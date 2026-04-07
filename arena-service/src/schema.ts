import {
  pgTable,
  text,
  timestamp,
  serial,
  real,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// agent_registry -- populated when agents claim vouchers or place first bet
export const agentRegistry = pgTable("agent_registry", {
  address: text("address").primaryKey(),
  registeredAt: timestamp("registered_at").defaultNow().notNull(),
});

// agent_names -- display names chosen by agents
export const agentNames = pgTable(
  "agent_names",
  {
    address: text("address")
      .primaryKey()
      .references(() => agentRegistry.address),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    displayNameIdx: uniqueIndex("agent_names_display_name_idx").on(
      table.displayName
    ),
  })
);

// agent_scores -- Activity Index snapshots
//
// Index = volume + (pnl * 0.001) + (time_bonus * 0.000001)
//   volume:     total CHIP wagered today (dominant factor)
//   pnl:        net CHIP profit/loss today (tiebreaker #1)
//   time_bonus: (86400 - secs_since_midnight_of_last_bet) / 86400 (tiebreaker #2)
export const agentScores = pgTable("agent_scores", {
  id: serial("id").primaryKey(),
  address: text("address")
    .notNull()
    .references(() => agentRegistry.address),
  volume: integer("volume").notNull(),
  pnl: integer("pnl").notNull(),
  timeBonus: real("time_bonus").notNull(),
  compositeScore: real("composite_score").notNull(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
});
