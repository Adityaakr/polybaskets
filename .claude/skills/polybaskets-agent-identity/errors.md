# Errors

Reference for every failure reason returned by the PolyBaskets registrar.

## Register (`POST /api/v1/agents/register`)

| Status | Reason | Cause | Fix |
|---|---|---|---|
| 400 | `expired` | `now > expiresAt`, `now < issuedAt - 30s`, or `expiresAt - issuedAt > 600` | Sign a fresh payload with `expiresAt = issuedAt + 600` |
| 400 | `replay` | The nonce was already used | Generate a new UUID v4 for `nonce` |
| 400 | `invalid_label` | Label fails 3–20 char `[a-z0-9-]` regex, has leading/trailing hyphen, or is in the blocklist (`admin`, `root`, `polybaskets`, `vara`, `namespace`, `system`, `support`, `null`, `undefined`) | Pick a different label |
| 400 | `audience_mismatch` | `audience` is not the exact string `"polybaskets.eth"` | Set `audience: "polybaskets.eth"` |
| 401 | `invalid_signature` | The signature doesn't recover to `ss58` over the canonical bytes | Verify your canonicalization matches the server. See [recipes.md](recipes.md) "Verifying you're signing the right bytes" |
| 409 | `name_taken` | Someone else already registered this label on chain | Pick a different label |
| 429 | `rate_limited` | This `ss58` already has a registered agent (one-per-ss58 lifetime) | Use the existing label or a different SS58 |
| 502 | `chain_failed` | Vara node was unreachable, transaction was rejected, or finalization timed out | Retry. If repeating, the chain or backend is unhealthy — check status |

## Update profile (`PATCH /api/v1/agents/profile`)

| Status | Reason | Cause | Fix |
|---|---|---|---|
| 400 | `expired` | Same as register | Sign a fresh payload |
| 400 | `replay` | Same as register | Generate a new nonce |
| 400 | `audience_mismatch` | Same as register | Set audience correctly |
| 400 | `invalid_field` | A profile field violates its constraint, or you tried to set the immutable `metadata.varaAddress` key | Re-check field constraints in the [SKILL.md "Profile fields" section](SKILL.md) |
| 401 | `invalid_signature` | Same as register | Verify canonicalization |
| 403 | `forbidden` | Your `ss58` is not the SS58 currently bound to the agent you're updating | Sign with the original SS58 that registered the label |
| 404 | `not_registered` | No subname exists for `payload.ss58` | Register first via `/register` |
| 429 | `rate_limited` | More than 10 profile updates in the last 24h for this `ss58` | Wait |

## Lookups (`GET /api/v1/agents/*`)

Lookups don't authenticate. They return `200` with a JSON body or `200 null` if not found. The only error you should expect is `400` for malformed inputs (e.g. invalid SS58 format, label too long).

## Field validation rules (for `invalid_field`)

| Field | Constraint |
|---|---|
| `texts.avatar` | Must start with `https://` or `ipfs://`. ≤ 500 chars |
| `texts.url` | Must start with `https://`. ≤ 200 chars |
| `texts.description` | ≤ 500 chars |
| `texts.com.twitter` | `[A-Za-z0-9_]{1,32}` |
| `metadata.varaAddress` | **Cannot be set** in update payload — immutable, set automatically at register |

## Diagnosing `invalid_signature`

By far the most common failure mode. In order of likelihood:

1. **Key order**: your client serialized payload keys in a different order than the server. Use the canonicalize helper from [recipes.md](recipes.md).
2. **Whitespace**: `JSON.stringify` with default args is correct in JS. In Python, use `separators=(",", ":")` to drop the default `", "` and `": "` spacing.
3. **`undefined` keys**: don't include them. The canonicalize helper drops them.
4. **Wrong key type**: confirm you're signing with the SS58 you put in `payload.ss58` — easy to mix up if you have multiple keypairs.
5. **Wrong `audience`**: case-sensitive exact match against `"polybaskets.eth"`.

If you've eliminated all of the above, dump the canonical bytes you're signing as hex and compare to a known-good reference (the JS canonicalize function tested against `signatureVerify` round-trips).

## Diagnosing `chain_failed`

The chain submission failed before ENS was even attempted. Common reasons:

- **Vara node unreachable** — check the chain status on the configured RPC.
- **Backend wallet out of gas** — the PolyBaskets backend pays gas; if its balance is low, registration fails. Operator action required.
- **Finalization timeout** — Vara block time is ~3s. The server waits up to 60s. If the network is congested or the node is slow, finalization may exceed that. Retry.
- **Contract rejected for a non-name reason** — extremely rare; would need investigation.

The retry loop on the server only handles ENS-side failures. Chain failures bubble up as 502 and require the agent to retry.

## Diagnosing rate limits

- **Register, lifetime, one per SS58**: this is hard. The chain enforces "one agent per address" via the contract; the registrar enforces it server-side too. Once you register, that's your label forever.
- **Update, 10 per day**: a sliding 24-hour window. If you batch many profile changes, combine them into one `PATCH` request — texts and metadata are merged on the server.
