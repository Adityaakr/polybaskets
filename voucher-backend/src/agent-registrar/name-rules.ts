export const RESERVED_NAMES = new Set([
  'default',
  'admin',
  'polybaskets',
  'root',
  'ens',
  'system',
]);

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])$/;

export function isNameAllowed(name: string): boolean {
  if (RESERVED_NAMES.has(name)) return false;
  return NAME_PATTERN.test(name);
}
