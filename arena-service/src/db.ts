import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const dbUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/polybaskets_arena";
const parsed = new URL(dbUrl);

const pool = new pg.Pool({
  host: parsed.hostname,
  port: parseInt(parsed.port || "5432"),
  user: parsed.username,
  password: parsed.password,
  database: parsed.pathname.slice(1),
});

export const db = drizzle(pool, { schema });
export { pool };
