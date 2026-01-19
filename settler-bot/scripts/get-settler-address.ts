import 'dotenv/config';
import { Keyring } from '@polkadot/api';

const { SETTLER_SEED } = process.env;

if (!SETTLER_SEED) {
  console.error('ERROR: SETTLER_SEED environment variable is required');
  console.error('Please set it in your .env file or export it:');
  console.error('  export SETTLER_SEED="your seed phrase here"');
  process.exit(1);
}

try {
  // Create keyring with Vara Network format (ss58Format: 137)
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 137 });
  
  // Add account from seed phrase
  const account = keyring.addFromUri(SETTLER_SEED);
  
  console.log('\n✅ Settler Account Address:\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Address: ${account.address}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📝 Send VARA tokens to this address to fund the settler bot.\n');
  console.log('💡 You can check the balance at:');
  console.log(`   https://vara.subscan.io/account/${account.address}\n`);
} catch (error) {
  console.error('❌ Error deriving address:', error);
  console.error('\nMake sure SETTLER_SEED is a valid seed phrase (12 words).');
  process.exit(1);
}
