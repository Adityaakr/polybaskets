#!/usr/bin/env tsx
/**
 * Utility script to extract keypair information from Polkadot.js JSON format
 * 
 * Usage:
 *   tsx scripts/extract-keypair.ts <keypair.json> [password]
 * 
 * If password not provided, will prompt for it
 */

import * as readline from 'readline';
import { Keyring } from '@polkadot/api';
import { decodeAddress } from '@polkadot/util-crypto';
import * as fs from 'fs';

function promptPassword(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Enter password for keypair: ', (password) => {
      rl.close();
      resolve(password);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: tsx scripts/extract-keypair.ts <keypair.json> [password]');
    process.exit(1);
  }

  const jsonPath = args[0];
  const password = args[1];

  if (!fs.existsSync(jsonPath)) {
    console.error(`Error: File not found: ${jsonPath}`);
    process.exit(1);
  }

  const keypairJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const actualPassword = password || await promptPassword();

  try {
    // Create keyring
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 137 }); // 137 = Vara Network
    
    // Add the keypair using the JSON (will decrypt automatically)
    const pair = keyring.addFromJson(keypairJson);
    
    // Unlock with password to get the raw keypair
    pair.unlock(actualPassword);
    
    // Get address and ActorId
    const address = pair.address;
    const actorId = Array.from(decodeAddress(address));
    const actorIdHex = '0x' + actorId.map(byte => byte.toString(16).padStart(2, '0')).join('');
    
    console.log('\n✅ Keypair extracted successfully!\n');
    console.log('Address (SS58):', address);
    console.log('ActorId (hex):', actorIdHex);
    console.log('ActorId (array):', JSON.stringify(actorId));
    
    // Extract seed phrase (if available)
    try {
      // Try to get the seed from the pair
      // Note: Some keypairs don't have a seed phrase (derived from raw secret)
      const seed = (pair as any).secretKey;
      if (seed) {
        console.log('\n⚠️  This keypair was created from raw secret, not a seed phrase.');
        console.log('To use with SETTLER_SEED, you need to use the JSON format directly,');
        console.log('or create a new keypair from a seed phrase.');
      }
    } catch (e) {
      // Seed not available
    }
    
    console.log('\n📝 For settler bot .env:');
    console.log('Option 1: Use the JSON file directly (not supported by current bot)');
    console.log('Option 2: If this matches your settler_role ActorId, use the password-protected JSON');
    console.log('Option 3: Create a new keypair from a seed phrase and redeploy contract');
    
    // Check if this matches the contract settler_role
    const contractSettlerRole = '0x62157dfe1901c6c0f46ea834398fe054a6e4e07e978d41d2f6832a73f5dda72c';
    if (actorIdHex.toLowerCase() === contractSettlerRole.toLowerCase()) {
      console.log('\n✅ MATCH! This ActorId matches the contract settler_role!');
      console.log('\n⚠️  IMPORTANT: The current bot uses seed phrases, not password-protected JSON.');
      console.log('You have two options:');
      console.log('1. Modify the bot to support password-protected JSON (requires code changes)');
      console.log('2. Create a new keypair from a seed phrase and redeploy the contract');
    } else {
      console.log('\n❌ This ActorId does NOT match the contract settler_role:', contractSettlerRole);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.message.includes('password')) {
      console.error('\nThe password is incorrect or the keypair format is invalid.');
    }
    process.exit(1);
  }
}

main().catch(console.error);
