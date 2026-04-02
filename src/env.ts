export const ENV = {
  NODE_ADDRESS: import.meta.env.VITE_NODE_ADDRESS || 'wss://testnet.vara.network',
  PROGRAM_ID: import.meta.env.VITE_PROGRAM_ID || '0x36cbc8f30e84f2a3fbf60655175fb0673aedba686299fafbcbd9659df6c20577',
  BET_TOKEN_PROGRAM_ID: import.meta.env.VITE_BET_TOKEN_PROGRAM_ID || '0xb8ce520bd76b01e869a46cb6888d0007e11ad821218aeff98fa7dda5b7baab07',
  BET_LANE_PROGRAM_ID: import.meta.env.VITE_BET_LANE_PROGRAM_ID || '0x59f1c06063fe47dd3f5c3c79b9e45c8d0f6296d602f0326a0c2ea07e4d4c8149',
  // Vara.eth (EVM) configuration
  VARAETH_RPC: import.meta.env.VITE_VARAETH_RPC || 'https://hoodi-reth-rpc.gear-tech.io',
  VARAETH_WS: import.meta.env.VITE_VARAETH_WS || 'wss://hoodi-reth-rpc.gear-tech.io/ws',
  VARAETH_ROUTER: import.meta.env.VITE_VARAETH_ROUTER || '0xBC888a8B050B9B76a985d91c815d2c4f2131a58A',
  VARAETH_PROGRAM_ID: import.meta.env.VITE_VARAETH_PROGRAM_ID || '0x36cbc8f30e84f2a3fbf60655175fb0673aedba686299fafbcbd9659df6c20577',
};
