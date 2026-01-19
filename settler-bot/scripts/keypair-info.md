# Keypair Information

## Your Keypair Details

**Address (SS58):** `5EHJw9Th6X7t3PhP5xAHg6ySpKTFTvbQqgQVDdyDQRReFDoz`

**Format:** Polkadot.js encrypted JSON format

## Important Limitations

### ❌ Cannot Extract Seed Phrase

**This keypair is in encrypted JSON format, NOT a seed phrase.**

- The `encoded` field contains the **encrypted** private key
- It requires a **password** to decrypt
- Even if decrypted, this keypair was likely created from a **raw secret**, not a seed phrase
- **You cannot get a seed phrase from this format**

### ✅ What You CAN Do

1. **Use it with password** (requires code changes to bot)
2. **Export as raw secret** (if you have password)
3. **Create new keypair from seed phrase** (recommended)

## Current Bot Limitation

The settler bot uses:
```typescript
const keyring = new Keyring({ type: 'sr25519', ss58Format: 137 });
this.settlerAccount = keyring.addFromUri(this.settlerSeed);  // Expects seed phrase
```

This means it expects a **seed phrase** (like `//Alice` or `word1 word2 ... word12`), NOT an encrypted JSON.

## Solutions

### Option 1: Modify Bot to Support Password-Protected JSON (Advanced)

You would need to:
1. Modify `settler-bot/src/vara.ts` to accept JSON + password
2. Use `keyring.addFromJson()` instead of `keyring.addFromUri()`
3. Handle password input securely

**Not recommended** - adds complexity and security concerns.

### Option 2: Create New Keypair from Seed Phrase (Recommended)

1. Generate a new keypair with a seed phrase:
   ```bash
   # Using Polkadot.js CLI or online tool
   # Generate a 12-word seed phrase
   ```

2. Get the ActorId from the new keypair

3. Redeploy the contract with the new ActorId as `settler_role`

4. Use the seed phrase in `settler-bot/.env`

### Option 3: Extract Raw Secret (If You Have Password)

If you have the password, you can:
1. Decrypt the JSON using Polkadot.js
2. Export the raw secret
3. Use the raw secret (but this still won't give you a seed phrase)

## Checking If This Matches Contract

To check if this keypair's ActorId matches your contract's `settler_role`:

1. Decrypt the JSON (requires password)
2. Get the ActorId: `0x62157dfe1901c6c0f46ea834398fe054a6e4e07e978d41d2f6832a73f5dda72c`
3. Compare with contract `settler_role`

**Contract settler_role:** `0x62157dfe1901c6c0f46ea834398fe054a6e4e07e978d41d2f6832a73f5dda72c`

## Recommendation

**Best approach:** Create a new keypair from a seed phrase and redeploy the contract. This gives you:
- ✅ Full control over the seed phrase
- ✅ Easier to use with the bot
- ✅ Better security practices
- ✅ No password management needed
