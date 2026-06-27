import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StellarHorizonService } from './stellar-horizon.service';
import { WebhookEventEmitterService } from '../webhooks/webhook-event-emitter.service';
import { BalanceRepository } from './balance.repository';
import {
  WalletBalance,
  Asset,
  AssetType,
  BalanceSyncStatus,
  BalanceUpdate,
  ReconciliationResult,
} from './domain/balance.model';

export interface SyncBalancesRequest {
  walletId: string;
  forceRefresh?: boolean;
}

export interface SyncBalancesResult {
  walletId: string;
  balancesUpdated: number;
  mismatchesFound: number;
  syncStatus: BalanceSyncStatus;
  lastSyncedAt: Date;
}

/**
 * Balance Indexer Service
 *
 * Responsibilities:
 * - Index wallet balances from Stellar Horizon
 * - Provide fast balance queries without hitting the blockchain
 * - Detect and reconcile balance mismatches
 * - Handle missed updates and recovery
 *
 * Domain events emitted:
 * - `balance.updated`  — when a balance value changes during a sync
 * - `balance.mismatch` — when indexed balance diverges from on-chain state
 * - `balance.synced`   — (future) full-sync completion summary
 *
 * Environment variables (validated at startup):
 * - `STELLAR_HORIZON_URL`        — Horizon API base URL (required)
 * - `BALANCE_STALE_THRESHOLD_MS` — Staleness window in ms (default: 300 000)
 */
@Injectable()
export class BalanceIndexerService implements OnModuleInit {
  private readonly logger = new Logger(BalanceIndexerService.name);
  private readonly staleThresholdMs: number;

  constructor(
    private readonly stellarHorizonService: StellarHorizonService,
    private readonly configService: ConfigService,
    private readonly webhookEventEmitter: WebhookEventEmitterService,
    private readonly balanceRepo: BalanceRepository,
  ) {
    this.staleThresholdMs = this.configService.get<number>(
      'BALANCE_STALE_THRESHOLD_MS',
      5 * 60 * 1000,
    );
  }

  /**
   * Validates required environment variables at module startup.
   * Throws if `STELLAR_HORIZON_URL` is missing or empty so the application
   * fails fast instead of silently falling back to an unexpected default.
   */
  onModuleInit(): void {
    const horizonUrl = this.configService.get<string>('STELLAR_HORIZON_URL');
    if (!horizonUrl || horizonUrl.trim() === '') {
      throw new Error(
        'STELLAR_HORIZON_URL must be set. ' +
          'Example: https://horizon-testnet.stellar.org',
      );
    }

    const threshold = this.configService.get<number>(
      'BALANCE_STALE_THRESHOLD_MS',
    );
    if (threshold !== undefined && (isNaN(threshold) || threshold <= 0)) {
      throw new Error(
        'BALANCE_STALE_THRESHOLD_MS must be a positive number when set.',
      );
    }

    this.logger.log(
      `Balance indexer ready (horizon=${horizonUrl}, staleThresholdMs=${this.staleThresholdMs})`,
    );
  }

  /**
   * Returns the cached balance for a wallet + asset combination.
   *
   * If the record exists but is stale, a background sync is triggered
   * asynchronously so the caller always gets a fast response.
   *
   * @param walletId  UUID of the wallet
   * @param asset     Asset descriptor (type, optional code/issuer)
   * @returns Cached `WalletBalance` or `null` if not indexed yet
   */
  async getBalance(
    walletId: string,
    asset: Asset,
  ): Promise<WalletBalance | null> {
    const balance = await this.balanceRepo.findOne(walletId, asset);

    if (!balance) {
      return null;
    }

    if (this.isBalanceStale(balance)) {
      this.logger.warn(
        `Balance is stale for wallet ${walletId}, asset ${asset.type}`,
      );
      // Trigger async refresh — do not await so the caller isn't blocked
      this.syncWalletBalances({ walletId }).catch((err) =>
        this.logger.error('Background balance refresh failed:', err),
      );
    }

    return balance;
  }

  /**
   * Returns all cached balances for a wallet, ordered by asset type.
   *
   * @param walletId UUID of the wallet
   */
  async getAllBalances(walletId: string): Promise<WalletBalance[]> {
    return this.balanceRepo.findAll(walletId);
  }

  /**
   * Fetches the latest balances from Stellar Horizon and upserts them into
   * the local index.
   *
   * Emits `balance.updated` for every balance that changed value.
   *
   * @param request  `{ walletId, forceRefresh? }`
   * @returns        Sync summary including counts and final sync status
   */
  async syncWalletBalances(
    request: SyncBalancesRequest,
  ): Promise<SyncBalancesResult> {
    const startTime = Date.now();
    const { walletId, forceRefresh = false } = request;

    this.logger.log(`Starting balance sync for wallet ${walletId}`);

    try {
      const wallet = await this.balanceRepo.findWallet(walletId);
      if (!wallet) {
        throw new NotFoundException(`Wallet ${walletId} not found`);
      }

      const accountExists = await this.stellarHorizonService.accountExists(
        wallet.publicKey,
      );

      if (!accountExists) {
        this.logger.warn(
          `Account ${wallet.publicKey} not found on-chain, setting zero balances`,
        );
        return this.setZeroBalances(walletId);
      }

      const horizonBalances =
        await this.stellarHorizonService.getAccountBalances(wallet.publicKey);

      let balancesUpdated = 0;
      let mismatchesFound = 0;

      for (const balanceUpdate of horizonBalances) {
        const result = await this.applyBalanceUpdate(
          walletId,
          balanceUpdate,
          forceRefresh,
        );
        if (result.updated) balancesUpdated++;
        if (result.mismatch) mismatchesFound++;
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Balance sync completed for wallet ${walletId} in ${duration}ms ` +
          `(${balancesUpdated} updated, ${mismatchesFound} mismatches)`,
      );

      return {
        walletId,
        balancesUpdated,
        mismatchesFound,
        syncStatus:
          mismatchesFound > 0
            ? BalanceSyncStatus.MISMATCH
            : BalanceSyncStatus.SYNCED,
        lastSyncedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`Balance sync failed for wallet ${walletId}:`, error);
      await this.balanceRepo.markFailed(walletId);
      throw new Error(`Balance sync failed: ${error.message}`);
    }
  }

  /**
   * Reconciles a specific asset balance against the live on-chain state.
   *
   * Emits `balance.mismatch` when a divergence is detected and automatically
   * corrects the indexed value.
   *
   * @param walletId UUID of the wallet
   * @param asset    Asset to reconcile
   * @returns        Reconciliation outcome with indexed vs on-chain values
   */
  async reconcileBalance(
    walletId: string,
    asset: Asset,
  ): Promise<ReconciliationResult> {
    this.logger.log(
      `Reconciling balance for wallet ${walletId}, asset ${asset.type}`,
    );

    const indexedBalance = await this.getBalance(walletId, asset);

    const wallet = await this.balanceRepo.findWallet(walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }

    const horizonBalances = await this.stellarHorizonService.getAccountBalances(
      wallet.publicKey,
    );
    const onChainBalance = horizonBalances.find((b) =>
      this.assetsMatch(b.asset, asset),
    );

    const indexed = indexedBalance?.balance ?? '0';
    const onChain = onChainBalance?.balance ?? '0';
    const matches = indexed === onChain;

    if (!matches) {
      this.logger.warn(
        `Balance mismatch for wallet ${walletId}: indexed=${indexed}, onChain=${onChain}`,
      );

      if (onChainBalance) {
        await this.applyBalanceUpdate(walletId, onChainBalance, true);
      }

      await this.balanceRepo.recordMismatch(walletId, asset);

      const assetLabel = asset.code ?? asset.type;
      const difference = this.calculateDifference(indexed, onChain);
      this.webhookEventEmitter
        .emitBalanceMismatch({
          walletId,
          asset: assetLabel,
          indexedBalance: indexed,
          onChainBalance: onChain,
          difference,
        })
        .catch((err) =>
          this.logger.error('Failed to emit balance.mismatch event:', err),
        );
    } else {
      await this.balanceRepo.clearMismatch(walletId, asset);
    }

    return {
      walletId,
      asset,
      indexedBalance: indexed,
      onChainBalance: onChain,
      matches,
      difference: matches
        ? undefined
        : this.calculateDifference(indexed, onChain),
    };
  }

  /**
   * Reconciles all balances across every active wallet.
   *
   * Intended as a scheduled maintenance operation. Errors for individual
   * wallets are caught and logged rather than aborting the full run.
   *
   * @returns Summary of wallets processed and mismatches found
   */
  async reconcileAllBalances(): Promise<{
    walletsProcessed: number;
    mismatchesFound: number;
  }> {
    this.logger.log('Starting full balance reconciliation');

    const wallets = await this.balanceRepo.findActiveWallets();
    let walletsProcessed = 0;
    let mismatchesFound = 0;

    for (const wallet of wallets) {
      try {
        const balances = await this.getAllBalances(wallet.id);
        for (const balance of balances) {
          const asset: Asset = {
            type: balance.assetType,
            code: balance.assetCode ?? undefined,
            issuer: balance.assetIssuer ?? undefined,
          };
          const result = await this.reconcileBalance(wallet.id, asset);
          if (!result.matches) mismatchesFound++;
        }
        walletsProcessed++;
      } catch (error) {
        this.logger.error(`Failed to reconcile wallet ${wallet.id}:`, error);
      }
    }

    this.logger.log(
      `Full reconciliation completed: ${walletsProcessed} wallets, ${mismatchesFound} mismatches`,
    );

    return { walletsProcessed, mismatchesFound };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Upserts a single balance record and emits `balance.updated` when the
   * stored value changes.
   */
  private async applyBalanceUpdate(
    walletId: string,
    balanceUpdate: BalanceUpdate,
    _forceUpdate: boolean,
  ): Promise<{ updated: boolean; mismatch: boolean }> {
    const existing = await this.balanceRepo.findOne(
      walletId,
      balanceUpdate.asset,
    );
    const previousBalance = existing?.balance ?? null;
    const mismatch = existing != null && existing.balance !== balanceUpdate.balance;

    await this.balanceRepo.upsert(walletId, balanceUpdate);

    // Emit balance.updated when the value actually changed
    if (previousBalance !== null && previousBalance !== balanceUpdate.balance) {
      const assetLabel = balanceUpdate.asset.code ?? balanceUpdate.asset.type;
      const change = this.calculateDifference(
        balanceUpdate.balance,
        previousBalance,
      );
      this.webhookEventEmitter
        .emitBalanceUpdated({
          walletId,
          asset: assetLabel,
          previousBalance,
          newBalance: balanceUpdate.balance,
          change,
        })
        .catch((err) =>
          this.logger.error('Failed to emit balance.updated event:', err),
        );
    }

    return { updated: true, mismatch };
  }

  private async setZeroBalances(walletId: string): Promise<SyncBalancesResult> {
    await this.balanceRepo.upsertNativeZero(walletId);
    return {
      walletId,
      balancesUpdated: 1,
      mismatchesFound: 0,
      syncStatus: BalanceSyncStatus.SYNCED,
      lastSyncedAt: new Date(),
    };
  }

  private isBalanceStale(balance: WalletBalance): boolean {
    if (!balance.lastSyncedAt) return true;
    return Date.now() - balance.lastSyncedAt.getTime() > this.staleThresholdMs;
  }

  private assetsMatch(a: Asset, b: Asset): boolean {
    return a.type === b.type && a.code === b.code && a.issuer === b.issuer;
  }

  private calculateDifference(a: string, b: string): string {
    return (parseFloat(a) - parseFloat(b)).toFixed(7);
  }
}
