import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../common/cache/cache.service';

/**
 * Short-lived cache for Stellar Horizon account-existence lookups.
 *
 * Horizon's `/accounts/{id}` endpoint is called on every wallet
 * activation and payment flow.  Caching the boolean result for a brief
 * window (default 30 s) eliminates duplicate round-trips without hiding
 * meaningful state changes.
 *
 * Keys never contain private keys, seeds, or user PII — only the
 * Stellar public key (G…) which is already public by design.
 */
@Injectable()
export class HorizonAccountCacheService {
  private readonly logger = new Logger(HorizonAccountCacheService.name);

  /** 30-second TTL — short enough to reflect account creation promptly. */
  static readonly TTL_MS = 30_000;

  private static readonly KEY_PREFIX = 'horizon:account:exists:';

  constructor(private readonly cache: CacheService) {}

  /**
   * Returns the cached existence flag, or `null` on a cache miss.
   */
  get(publicKey: string): boolean | null {
    const result = this.cache.get<boolean>(this.key(publicKey));
    if (result !== null) {
      this.logger.debug(`[horizon-cache] hit publicKey=${publicKey.substring(0, 8)}…`);
    }
    return result;
  }

  /**
   * Stores whether the account exists on-chain.
   */
  set(publicKey: string, exists: boolean, ttlMs = HorizonAccountCacheService.TTL_MS): void {
    this.cache.set(this.key(publicKey), exists, ttlMs);
    this.logger.debug(
      `[horizon-cache] set publicKey=${publicKey.substring(0, 8)}… exists=${exists} ttl=${ttlMs}ms`,
    );
  }

  /**
   * Evicts a single entry — call after an account is known to have been
   * funded so the next check hits Horizon directly.
   */
  invalidate(publicKey: string): void {
    const deleted = this.cache.delete(this.key(publicKey));
    if (deleted) {
      this.logger.debug(`[horizon-cache] invalidated publicKey=${publicKey.substring(0, 8)}…`);
    }
  }

  private key(publicKey: string): string {
    return `${HorizonAccountCacheService.KEY_PREFIX}${publicKey}`;
  }
}
