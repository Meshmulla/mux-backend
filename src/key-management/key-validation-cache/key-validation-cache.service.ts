import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry {
  result: boolean;
  expiresAt: number;
}

/**
 * In-memory cache stub for key-pair validation results.
 *
 * Prevents redundant decryption on hot paths where the same key is validated
 * repeatedly within a short window (e.g. transaction signing bursts). The TTL
 * is deliberately short so stale entries do not mask a key that has been
 * rotated or revoked.
 *
 * This is a stub implementation — a production deployment would back this with
 * Redis so that the cache survives pod restarts and is shared across replicas.
 */
@Injectable()
export class KeyValidationCacheService {
  private readonly logger = new Logger(KeyValidationCacheService.name);

  private readonly cache = new Map<string, CacheEntry>();

  /** Default TTL in milliseconds (30 seconds). */
  private readonly DEFAULT_TTL_MS = 30_000;

  /** Maximum number of entries kept in memory at any time. */
  private readonly MAX_ENTRIES = 1_000;

  /**
   * Returns a cached validation result for the given key pair, or undefined if
   * no live entry exists.
   */
  get(publicKey: string, encryptedKeyMaterial: string): boolean | undefined {
    const key = this.buildCacheKey(publicKey, encryptedKeyMaterial);
    const entry = this.cache.get(key);

    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.result;
  }

  /**
   * Stores a validation result in the cache.
   * Only caches positive results — negative results (mismatched or invalid
   * keys) are never cached so that corrected keys are visible immediately.
   */
  set(
    publicKey: string,
    encryptedKeyMaterial: string,
    result: boolean,
    ttlMs: number = this.DEFAULT_TTL_MS,
  ): void {
    if (!result) return;

    if (this.cache.size >= this.MAX_ENTRIES) {
      this.evictExpired();

      if (this.cache.size >= this.MAX_ENTRIES) {
        this.logger.warn(
          `KeyValidationCache full (${this.MAX_ENTRIES} entries) — skipping cache write`,
        );
        return;
      }
    }

    const key = this.buildCacheKey(publicKey, encryptedKeyMaterial);
    this.cache.set(key, { result, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Invalidates all cached entries for a public key (e.g. after key rotation).
   */
  invalidate(publicKey: string): void {
    let removed = 0;
    for (const k of this.cache.keys()) {
      if (k.startsWith(`${publicKey}:`)) {
        this.cache.delete(k);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(`Invalidated ${removed} cache entries for key ${publicKey.substring(0, 12)}...`);
    }
  }

  /** Returns the number of live (non-expired) entries currently cached. */
  size(): number {
    this.evictExpired();
    return this.cache.size;
  }

  /** Clears all entries — useful in tests. */
  clear(): void {
    this.cache.clear();
  }

  private buildCacheKey(publicKey: string, encryptedKeyMaterial: string): string {
    // Use a short hash of the encrypted material to keep key sizes manageable
    return `${publicKey}:${encryptedKeyMaterial.substring(0, 32)}`;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [k, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(k);
      }
    }
  }
}
