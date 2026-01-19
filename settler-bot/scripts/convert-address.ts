#!/usr/bin/env tsx
/**
 * Utility script to convert SS58 address to ActorId format
 * 
 * Usage:
 *   tsx scripts/convert-address.ts <ss58_address>
 * 
 * Example:
 *   tsx scripts/convert-address.ts kGgaULhKHkGCF93BoaGcmKmbxNWPDZDjpukDKNFQj5egJhtNV
 */

import { decodeAddress } from '@polkadot/util-crypto';

function convertSS58ToActorId(ss58Address: string): {
  address: string;
  actorIdHex: string;
  actorIdArray: number[];
} {
  try {
    // Decode SS58 address to bytes (ActorId is the raw 32 bytes)
    const bytes = decodeAddress(ss58Address);
    
    // ActorId is 32 bytes for Vara Network
    if (bytes.length !== 32) {
      throw new Error(`Expected 32 bytes, got ${bytes.length} bytes`);
    }
    
    // Convert to hex string (with 0x prefix)
    const actorIdHex = '0x' + Array.from(bytes)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    
    // Convert to array format [u8;32]
    const actorIdArray = Array.from(bytes);
    
    return {
      address: ss58Address,
      actorIdHex,
      actorIdArray,
    };
  } catch (error) {
    throw new Error(`Failed to convert address: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: tsx scripts/convert-address.ts <ss58_address>');
    console.error('');
    console.error('Example:');
    console.error('  tsx scripts/convert-address.ts kGgaULhKHkGCF93BoaGcmKmbxNWPDZDjpukDKNFQj5egJhtNV');
    process.exit(1);
  }

  const ss58Address = args[0];

  try {
    const result = convertSS58ToActorId(ss58Address);
    
    console.log('\n✅ Address converted successfully!\n');
    console.log('SS58 Address:', result.address);
    console.log('ActorId (hex):', result.actorIdHex);
    console.log('ActorId (array):', JSON.stringify(result.actorIdArray));
    console.log('');
    console.log('📋 For contract constructor (settler_role):');
    console.log('  ActorId:', result.actorIdHex);
    console.log('');
    console.log('📝 For settler-bot/.env:');
    console.log('  You need the SEED PHRASE that corresponds to this address.');
    console.log('  SETTLER_SEED=your_seed_phrase_here');
    console.log('');
    
    // Compare with current contract settler_role
    const currentSettlerRole = '0x62157dfe1901c6c0f46ea834398fe054a6e4e07e978d41d2f6832a73f5dda72c';
    if (result.actorIdHex.toLowerCase() === currentSettlerRole.toLowerCase()) {
      console.log('⚠️  This matches the current contract settler_role!');
      console.log('   No contract redeployment needed if you have the seed phrase.');
    } else {
      console.log('⚠️  This does NOT match the current contract settler_role:');
      console.log('   Current:', currentSettlerRole);
      console.log('   New:    ', result.actorIdHex);
      console.log('');
      console.log('📌 To use this address:');
      console.log('   1. Get the seed phrase for this address');
      console.log('   2. Redeploy contract with new settler_role:', result.actorIdHex);
      console.log('   3. Update frontend .env with new PROGRAM_ID');
      console.log('   4. Use seed phrase in settler-bot/.env');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    console.error('');
    console.error('Make sure the address is a valid Vara Network SS58 address.');
    process.exit(1);
  }
}

main();
