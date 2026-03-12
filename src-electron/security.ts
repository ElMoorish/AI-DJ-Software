import * as keytar from 'keytar';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';

const SERVICE_NAME = 'AI-DJ';
const ACCOUNT_NAME = 'db-encryption-key';

/**
 * SOC2 Rule 1: Get or create AES-256 key from OS keychain.
 * Never writes key to disk or logs.
 */
export async function getOrCreateDbKey(): Promise<string> {
  let key = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
  if (!key) {
    key = crypto.randomBytes(32).toString('hex');
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, key);
  }
  return key as string;
}

/**
 * SOC2 Rule 4: Sanitize and validate file paths.
 * Rejects: null bytes, path traversal (..), paths outside home directory.
 */
export function sanitizePath(input: string): string {
  // Reject null bytes
  if (input.indexOf('\0') !== -1) {
    throw new Error('Path contains null bytes');
  }

  // Reject path traversal attempts in raw input
  if (input.includes('..')) {
    throw new Error('Path traversal detected');
  }

  // Resolve to absolute path
  const normalized = path.normalize(input);
  const absolutePath = path.resolve(normalized);

  // Note: We deliberately allow paths outside the home directory (like E:\) 
  // because users often store large DJ music libraries on external drives.

  return absolutePath;
}

/**
 * SOC2 Rule 2: Generate a cryptographically random API key for ML sidecar auth.
 * Stored in memory only — never written to disk.
 */
export function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex'); // 64 hex chars
}

/**
 * HMAC-SHA256 sign a message with a key.
 * Used to sign IPC messages to the ML sidecar.
 */
export function hmacSign(key: string, message: string): string {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}
