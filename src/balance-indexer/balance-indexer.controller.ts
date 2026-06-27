import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  BalanceIndexerService,
  SyncBalancesRequest,
} from './balance-indexer.service';
import { Asset, AssetType } from './domain/balance.model';

/**
 * Balance Indexer Controller
 *
 * Exposes cached Stellar wallet balances and reconciliation operations.
 *
 * All read endpoints (`GET`) serve from the local index and never hit
 * Stellar Horizon directly, ensuring sub-millisecond response times.
 *
 * Write/action endpoints (`POST /sync`, `POST /reconcile`) do communicate
 * with Horizon and may take longer depending on network latency.
 *
 * Base path: `/balances`
 */
@Controller('balances')
export class BalanceIndexerController {
  constructor(private readonly balanceIndexerService: BalanceIndexerService) {}

  /**
   * `GET /balances/wallet/:walletId`
   *
   * Returns indexed balances for a wallet.
   *
   * - Without query parameters → returns **all** cached balances for the wallet.
   * - With `assetType` → returns the single balance for that asset.
   *   If the asset is not yet indexed, a zero-balance placeholder is returned.
   *
   * Query parameters:
   * - `assetType`   — `NATIVE | CREDIT_ALPHANUM4 | CREDIT_ALPHANUM12 | LIQUIDITY_POOL_SHARES`
   * - `assetCode`   — e.g. `USDC` (required when assetType is not NATIVE)
   * - `assetIssuer` — issuer public key (required when assetType is not NATIVE)
   *
   * Responses:
   * - `200` — balance data (see examples below)
   *
   * All-balances response example:
   * ```json
   * { "walletId": "uuid", "balances": [ { "assetType": "NATIVE", "balance": "100.0000000", ... } ] }
   * ```
   *
   * Single-asset response example (not indexed):
   * ```json
   * { "balance": "0", "assetType": "NATIVE", "assetCode": null, "assetIssuer": null }
   * ```
   *
   * Notes:
   * - Stale balances (older than `BALANCE_STALE_THRESHOLD_MS`) trigger a
   *   background sync; the stale value is still returned immediately.
   * - Authentication: inherits global API-key guard.
   */
  @Get('wallet/:walletId')
  async getWalletBalance(
    @Param('walletId') walletId: string,
    @Query('assetType') assetType?: string,
    @Query('assetCode') assetCode?: string,
    @Query('assetIssuer') assetIssuer?: string,
  ) {
    if (assetType) {
      const asset: Asset = {
        type: (assetType as AssetType) || AssetType.NATIVE,
        code: assetCode,
        issuer: assetIssuer,
      };
      const balance = await this.balanceIndexerService.getBalance(
        walletId,
        asset,
      );
      return balance ?? { balance: '0', assetType, assetCode, assetIssuer };
    }

    const balances = await this.balanceIndexerService.getAllBalances(walletId);
    return { walletId, balances };
  }

  /**
   * `POST /balances/wallet/:walletId/sync`
   *
   * Triggers an on-demand balance sync from Stellar Horizon for the given
   * wallet, updating the local index with the latest on-chain values.
   *
   * Request body (optional):
   * ```json
   * { "forceRefresh": true }
   * ```
   * - `forceRefresh` — when `true`, overwrites the index even if values have
   *   not changed (useful after suspected missed events).
   *
   * Response `200`:
   * ```json
   * {
   *   "walletId": "uuid",
   *   "balancesUpdated": 2,
   *   "mismatchesFound": 0,
   *   "syncStatus": "SYNCED",
   *   "lastSyncedAt": "2026-06-27T17:00:00.000Z"
   * }
   * ```
   *
   * Error responses:
   * - `404` — wallet not found
   * - `500` — Horizon request failed
   *
   * Side effects:
   * - Emits `balance.updated` webhook events for each balance that changed.
   * - Sets balances to zero if the Stellar account does not yet exist on-chain.
   */
  @Post('wallet/:walletId/sync')
  @HttpCode(HttpStatus.OK)
  async syncWalletBalances(
    @Param('walletId') walletId: string,
    @Body() body: { forceRefresh?: boolean } = {},
  ) {
    const request: SyncBalancesRequest = {
      walletId,
      forceRefresh: body.forceRefresh ?? false,
    };
    return this.balanceIndexerService.syncWalletBalances(request);
  }

  /**
   * `POST /balances/wallet/:walletId/reconcile`
   *
   * Compares the indexed balance for a specific asset against the live
   * Horizon state and corrects any divergence.
   *
   * Request body:
   * ```json
   * { "assetType": "CREDIT_ALPHANUM4", "assetCode": "USDC", "assetIssuer": "GA5Z..." }
   * ```
   *
   * Response `200`:
   * ```json
   * {
   *   "walletId": "uuid",
   *   "asset": { "type": "CREDIT_ALPHANUM4", "code": "USDC", "issuer": "GA5Z..." },
   *   "indexedBalance": "100.0000000",
   *   "onChainBalance": "101.0000000",
   *   "matches": false,
   *   "difference": "-1.0000000"
   * }
   * ```
   *
   * Side effects:
   * - When a mismatch is found: updates the index, increments
   *   `reconciliationAttempts`, and emits a `balance.mismatch` webhook event.
   * - When balances match: clears any prior `mismatchDetectedAt` timestamp.
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
    return this.balanceIndexerService.reconcileBalance(walletId, asset);
  }

  /**
   * `POST /balances/reconcile-all`
   *
   * Reconciles all indexed balances across every **active** wallet.
   *
   * This is a maintenance / admin operation. It iterates all active wallets,
   * compares each indexed balance against Horizon, and corrects mismatches.
   * Individual wallet failures are swallowed and logged so the full run
   * completes even if some wallets are unreachable.
   *
   * Response `200`:
   * ```json
   * { "walletsProcessed": 42, "mismatchesFound": 1 }
   * ```
   *
   * Notes:
   * - May be slow on large datasets. Run outside peak hours.
   * - Emits `balance.mismatch` events for every divergence found.
   * - Recommended: protect this endpoint with an admin-level API key scope
   *   in a future iteration.
   */
  @Post('reconcile-all')
  @HttpCode(HttpStatus.OK)
  async reconcileAllBalances() {
    return this.balanceIndexerService.reconcileAllBalances();
  }
}
