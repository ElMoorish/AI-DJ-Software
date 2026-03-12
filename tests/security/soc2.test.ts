import { describe, it, expect } from 'vitest';
import { sanitizePath, hmacSign, generateApiKey } from '../../src-electron/security';
import * as path from 'path';
import * as os from 'os';

describe('SOC2 Security Rules', () => {

  describe('Rule 4: Input Sanitization', () => {
    it('should reject paths with null bytes', () => {
      expect(() => sanitizePath('/foo/bar\0baz')).toThrow('Path contains null bytes');
    });

    it('should reject path traversal attempts', () => {
      // Test various traversal patterns
      expect(() => sanitizePath('/user/dj/../../etc/passwd')).toThrow('Path traversal detected');
    });

    it('should return an absolute path for valid input', () => {
      const p = path.join(os.homedir(), 'Music');
      const sanitized = sanitizePath(p);
      expect(path.isAbsolute(sanitized)).toBe(true);
    });
  });

  describe('Rule 3: Audit Log (Logic Check)', () => {
    it('should generate valid HMAC signatures for IPC', () => {
      const key = 'test-secret';
      const message = 'test-message';
      const sig1 = hmacSign(key, message);
      const sig2 = hmacSign(key, message);
      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(64); // SHA-256 hex
    });
  });

  describe('Rule 2: Local Only', () => {
    it('should verify API Key generation entropy', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
      expect(key1.length).toBe(64);
    });
  });
});
