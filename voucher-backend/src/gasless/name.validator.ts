import { Injectable } from '@nestjs/common';

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])?$/;
const MIN_LEN = 3;
const MAX_LEN = 20;
const BLOCKLIST = new Set([
  'admin',
  'root',
  'polybaskets',
  'vara',
  'namespace',
  'system',
  'support',
  'null',
  'undefined',
]);

export type ValidationResult =
  | { ok: true; reason?: undefined }
  | { ok: false; reason: 'too short' | 'too long' | 'invalid' | 'blocked' };

@Injectable()
export class NameValidator {
  validate(label: string): ValidationResult {
    if (label.length < MIN_LEN) return { ok: false, reason: 'too short' };
    if (label.length > MAX_LEN) return { ok: false, reason: 'too long' };
    if (BLOCKLIST.has(label)) return { ok: false, reason: 'blocked' };
    if (!LABEL_RE.test(label)) return { ok: false, reason: 'invalid' };
    return { ok: true };
  }

  isValid(label: string): boolean {
    return this.validate(label).ok === true;
  }
}
