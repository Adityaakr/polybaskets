import {
  pgTable,
  text,
  timestamp,
  serial,
  real,
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

// agent_scores -- hourly Activity Index snapshots
export const agentScores = pgTable("agent_scores", {
  id: serial("id").primaryKey(),
  address: text("address")
    .notNull()
    .references(() => agentRegistry.address),
  pnlScore: real("pnl_score").notNull(),
  basketsScore: real("baskets_score").notNull(),
  streakScore: real("streak_score").notNull(),
  compositeScore: real("composite_score").notNull(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
});
