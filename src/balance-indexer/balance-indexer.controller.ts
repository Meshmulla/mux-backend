import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  BalanceIndexerService,
  SyncBalancesRequest,
} from './balance-indexer.service';
import { Asset, AssetType, WalletBalance } from './domain/balance.model';

/** Shape returned by the multi-asset balance endpoint. */
export interface MultiAssetBalanceResponse {
  walletId: string;
  /** Total number of distinct assets held by this wallet. */
  assetCount: number;
  balances: Array<{
    assetType: AssetType;
    /** Human-readable ticker, e.g. "XLM", "USDC". Null for native XLM. */
    assetCode: string | null;
    /** Issuer public key. Null for native XLM. */
    assetIssuer: string | null;
    /** Decimal string to preserve full Stellar precision (7 dp). */
    balance: string;
    syncStatus: string;
    lastSyncedAt: Date | null;
  }>;
}

@Controller('balances')
export class BalanceIndexerController {
  constructor(private readonly balanceIndexerService: BalanceIndexerService) {}

  /**
   * GET /balances/wallet/:walletId
   *
   * Multi-asset balance response. Returns every asset held by the wallet in a
   * consistent, typed envelope so frontend and partner integrations can render
   * XLM, USDC, and any other Stellar asset from a single call.
   *
   * Response shape: {@link MultiAssetBalanceResponse}
   */
  @Get('wallet/:walletId')
  async getWalletBalances(
    @Param('walletId') walletId: string,
  ): Promise<MultiAssetBalanceResponse> {
    const balances = await this.balanceIndexerService.getAllBalances(walletId);
    return this.toMultiAssetResponse(walletId, balances);
  }

  /**
   * GET /balances/wallet/:walletId/asset
   *
   * Returns a single-asset balance when `assetType` is provided, or falls back
   * to the full multi-asset response when it is omitted.
   *
   * Query params:
   *   - assetType  (required) – one of NATIVE | CREDIT_ALPHANUM4 | CREDIT_ALPHANUM12
   *   - assetCode  (optional) – e.g. "USDC"
   *   - assetIssuer (optional) – issuer public key
   */
  @Get('wallet/:walletId/asset')
  async getWalletAssetBalance(
    @Param('walletId') walletId: string,
    @Query('assetType') assetType: string,
    @Query('assetCode') assetCode?: string,
    @Query('assetIssuer') assetIssuer?: string,
  ): Promise<MultiAssetBalanceResponse> {
    if (!assetType) {
      // No filter — return all assets.
      const all = await this.balanceIndexerService.getAllBalances(walletId);
      return this.toMultiAssetResponse(walletId, all);
    }

    if (!Object.values(AssetType).includes(assetType as AssetType)) {
      throw new BadRequestException(
        `Invalid assetType '${assetType}'. Must be one of: ${Object.values(AssetType).join(', ')}`,
      );
    }

    const asset: Asset = {
      type: assetType as AssetType,
      code: assetCode,
      issuer: assetIssuer,
    };

    const balance = await this.balanceIndexerService.getBalance(walletId, asset);

    if (!balance) {
      throw new NotFoundException(
        `No balance record found for wallet '${walletId}' and asset '${assetType}'`,
      );
    }

    return this.toMultiAssetResponse(walletId, [balance]);
  }

  /**
   * Manually triggers a balance sync for a single wallet from Stellar Horizon.
   * Useful when a wallet owner reports stale balance data.
   */
  @Post('wallet/:walletId/sync')
  @HttpCode(HttpStatus.OK)
  async syncWalletBalances(
    @Param('walletId') walletId: string,
    @Body() body: { forceRefresh?: boolean } = {},
  ) {
    const request: SyncBalancesRequest = {
      walletId,
      forceRefresh: body.forceRefresh || false,
    };
    return await this.balanceIndexerService.syncWalletBalances(request);
  }

  /**
   * Manually triggers a full balance sync across all active wallets.
   * Admin-only operation. Tracked via BalanceSyncJob records.
   */
  @Post('sync-all')
  @HttpCode(HttpStatus.OK)
  async syncAllWallets() {
    return await this.balanceIndexerService.syncAllWallets();
  }

  /**
   * Reconciles a wallet's indexed balance with on-chain state.
   */
  @Post('wallet/:walletId/reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcileWalletBalance(
    @Param('walletId') walletId: string,
    @Body()
    body: { assetType: string; assetCode?: string; assetIssuer?: string },
  ) {
    const asset: Asset = {
      type: body.assetType as AssetType,
      code: body.assetCode,
      issuer: body.assetIssuer,
    };
    return await this.balanceIndexerService.reconcileBalance(walletId, asset);
  }

  /**
   * Reconciles all balances for all active wallets.
   * Admin-only maintenance operation.
   */
  @Post('reconcile-all')
  @HttpCode(HttpStatus.OK)
  async reconcileAllBalances() {
    return await this.balanceIndexerService.reconcileAllBalances();
  }

  /**
   * Syncs balances with retry backoff
   */
  @Post('wallet/:walletId/sync-with-retry')
  @HttpCode(HttpStatus.OK)
  async syncWithRetry(
    @Param('walletId') walletId: string,
    @Body() body: { forceRefresh?: boolean } = {},
  ) {
    return this.balanceIndexerService.syncWalletBalancesWithRetry({
      walletId,
      forceRefresh: body.forceRefresh || false,
    });
  }

  /**
   * Detects stale balances for a wallet
   */
  @Get('wallet/:walletId/stale')
  async detectStaleBalances(@Param('walletId') walletId: string) {
    return this.balanceIndexerService.detectStaleBalances(walletId);
  }

  /**
   * Triggers the scheduled sync manually
   */
  @Post('sync-all')
  @HttpCode(HttpStatus.OK)
  async syncAll() {
    await this.balanceIndexerService.runScheduledSync();
    return { status: 'scheduled sync triggered' };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Maps an array of domain WalletBalance records to the typed
   * {@link MultiAssetBalanceResponse} envelope used by all balance endpoints.
   *
   * Private keys and encrypted material are never included — only public
   * balance data is projected here.
   */
  private toMultiAssetResponse(
    walletId: string,
    balances: WalletBalance[],
  ): MultiAssetBalanceResponse {
    return {
      walletId,
      assetCount: balances.length,
      balances: balances.map((b) => ({
        assetType: b.assetType,
        assetCode: b.assetCode ?? null,
        assetIssuer: b.assetIssuer ?? null,
        balance: b.balance,
        syncStatus: b.syncStatus,
        lastSyncedAt: b.lastSyncedAt ?? null,
      })),
    };
  }
}
