import { Hono } from "hono";
import { db } from "../db.js";
import { agentNames, agentRegistry } from "../schema.js";
import { eq } from "drizzle-orm";

const names = new Hono();

const NAME_REGEX = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const RENAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isValidName(name: string): boolean {
  return NAME_REGEX.test(name) && name.length >= 3 && name.length <= 20;
}

// POST /api/names -- register or update display name
names.post("/", async (c) => {
  const body = await c.req.json();
  const { address, display_name, signature } = body;

  if (!address || !display_name) {
    return c.json({ error: "address and display_name are required" }, 400);
  }

  if (!ADDRESS_REGEX.test(address)) {
    return c.json({ error: "invalid address format" }, 400);
  }

  const normalizedName = display_name.toLowerCase().trim();

  if (!isValidName(normalizedName)) {
    return c.json(
      {
        error:
          "display_name must be 3-20 characters, alphanumeric and hyphens only, " +
          "must start and end with alphanumeric",
      },
      400
    );
  }

  // TODO: Verify signature against address. For v1, we only check address format.
  // When implementing, use EIP-712 or EIP-191 personal_sign verification.
  if (!signature) {
    return c.json({ error: "signature is required" }, 400);
  }

  try {
    // Ensure agent is registered
    const existing = await db
      .select()
      .from(agentRegistry)
      .where(eq(agentRegistry.address, address))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(agentRegistry).values({ address });
    }

    // Check if name is already taken by someone else
    const nameTaken = await db
      .select()
      .from(agentNames)
      .where(eq(agentNames.displayName, normalizedName))
      .limit(1);

    if (nameTaken.length > 0 && nameTaken[0].address !== address) {
      return c.json({ error: "display_name is already taken" }, 409);
    }

    // Check if this address already has a name (rename flow)
    const currentName = await db
      .select()
      .from(agentNames)
      .where(eq(agentNames.address, address))
      .limit(1);

    if (currentName.length > 0) {
      // Rename -- enforce 7-day cooldown
      const lastUpdate = currentName[0].updatedAt.getTime();
      const now = Date.now();

      if (now - lastUpdate < RENAME_COOLDOWN_MS) {
        const nextAllowed = new Date(lastUpdate + RENAME_COOLDOWN_MS);
        return c.json(
          {
            error: `rename allowed after ${nextAllowed.toISOString()}`,
          },
          400
        );
      }

      await db
        .update(agentNames)
        .set({ displayName: normalizedName, updatedAt: new Date() })
        .where(eq(agentNames.address, address));

      console.log(
        `[${new Date().toISOString()}] name-rename address=${address} name=${normalizedName}`
      );

      return c.json(
        { address, display_name: normalizedName, renamed: true },
        200
      );
    }

    // New registration
    await db.insert(agentNames).values({
      address,
      displayName: normalizedName,
    });

    console.log(
      `[${new Date().toISOString()}] name-register address=${address} name=${normalizedName}`
    );

    return c.json({ address, display_name: normalizedName }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(
      `[${new Date().toISOString()}] name-register error: ${message}`
    );
    return c.json({ error: "internal server error" }, 500);
  }
});

// GET /api/names/:addr -- resolve display name for an address
names.get("/:addr", async (c) => {
  const addr = c.req.param("addr");

  if (!ADDRESS_REGEX.test(addr)) {
    return c.json({ error: "invalid address format" }, 400);
  }

  const result = await db
    .select()
    .from(agentNames)
    .where(eq(agentNames.address, addr))
    .limit(1);

  if (result.length === 0) {
    return c.json({ error: "not found" }, 404);
  }

  return c.json({
    address: result[0].address,
    display_name: result[0].displayName,
  });
});

export default names;
