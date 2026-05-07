/**
 * Tests: ProviderError (types.ts)
 *
 * Covers:
 * - Error construction with all fields
 * - isRetryable classification for every error code
 * - Edge cases: missing optional fields
 */

import { describe, it, expect } from 'vitest';
import { ProviderError, ProviderErrorCode } from '../../src/llm/types.js';

describe('ProviderError', () => {
  describe('construction', () => {
    it('should create with message and code', () => {
      const err = new ProviderError('test error', ProviderErrorCode.RATE_LIMITED);
      expect(err.message).toBe('test error');
      expect(err.code).toBe(ProviderErrorCode.RATE_LIMITED);
      expect(err.name).toBe('ProviderError');
    });

    it('should create with status code', () => {
      const err = new ProviderError('auth failed', ProviderErrorCode.AUTH_ERROR, 401);
      expect(err.status).toBe(401);
      expect(err.retryAfterMs).toBeUndefined();
    });

    it('should create with retryAfterMs', () => {
      const err = new ProviderError(
        'too many requests',
        ProviderErrorCode.RATE_LIMITED,
        429,
        30000,
      );
      expect(err.status).toBe(429);
      expect(err.retryAfterMs).toBe(30000);
    });

    it('should create with all fields undefined', () => {
      const err = new ProviderError('minimal', ProviderErrorCode.UNKNOWN);
      expect(err.status).toBeUndefined();
      expect(err.retryAfterMs).toBeUndefined();
      expect(err.message).toBe('minimal');
    });
  });

  describe('isRetryable', () => {
    const retryableCodes = [
      ProviderErrorCode.RATE_LIMITED,
      ProviderErrorCode.OVERLOADED,
      ProviderErrorCode.SERVER_ERROR,
      ProviderErrorCode.NETWORK_ERROR,
    ];

    const nonRetryableCodes = [
      ProviderErrorCode.AUTH_ERROR,
      ProviderErrorCode.INVALID_REQUEST,
      ProviderErrorCode.UNKNOWN,
    ];

    for (const code of retryableCodes) {
      it(`should be retryable for ${code}`, () => {
        const err = new ProviderError('test', code);
        expect(err.isRetryable).toBe(true);
      });
    }

    for (const code of nonRetryableCodes) {
      it(`should NOT be retryable for ${code}`, () => {
        const err = new ProviderError('test', code);
        expect(err.isRetryable).toBe(false);
      });
    }
  });

  describe('error message edge cases', () => {
    it('should handle empty message', () => {
      const err = new ProviderError('', ProviderErrorCode.UNKNOWN);
      expect(err.message).toBe('');
    });

    it('should handle very long message', () => {
      const longMsg = 'x'.repeat(10000);
      const err = new ProviderError(longMsg, ProviderErrorCode.SERVER_ERROR);
      expect(err.message).toBe(longMsg);
    });

    it('should handle special characters in message', () => {
      const err = new ProviderError(
        'Error: {"code": 429}\nRetry later',
        ProviderErrorCode.RATE_LIMITED,
      );
      expect(err.message).toContain('{');
      expect(err.message).toContain('\n');
    });
  });

  describe('retryAfterMs edge cases', () => {
    it('should handle 0ms retry', () => {
      const err = new ProviderError('instant', ProviderErrorCode.RATE_LIMITED, 429, 0);
      expect(err.retryAfterMs).toBe(0);
    });

    it('should handle very large retryAfterMs', () => {
      const err = new ProviderError('long wait', ProviderErrorCode.RATE_LIMITED, 429, 3_600_000);
      expect(err.retryAfterMs).toBe(3_600_000);
    });
  });
});
