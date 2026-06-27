import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import {
  BalanceIndexerService,
  SyncBalancesRequest,
} from './balance-indexer.service';
import { Asset, AssetType } from './domain/balance.model';
import { GetBalanceQueryDto } from './dto/get-balance.query';
import { SyncBalancesDto } from './dto/sync-balances.dto';
import { ReconcileBalanceDto } from './dto/reconcile-balance.dto';
import { BalanceFilterDto } from './dto/balance-filter.dto';
import { WalletBalanceResponseDto } from './dto/wallet-balance.response';
import { SyncResultResponseDto } from './dto/sync-result.response';
import { ReconciliationResultResponseDto } from './dto/reconciliation-result.response';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('balances')
@Controller('balances')
export class BalanceIndexerController {
  constructor(private readonly balanceIndexerService: BalanceIndexerService) {}

  /**
   * Gets all balances for a specific wallet with pagination and filtering.
   */
  @Get('wallet/:walletId')
  @ApiOperation({ summary: 'Get all balances for a wallet with pagination and filtering' })
  @ApiParam({ name: 'walletId', description: 'Wallet ID (UUID)' })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (starting from 1)' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (max 100)' })
  @ApiQuery({ name: 'assetType', required: false, enum: AssetType, description: 'Filter by asset type' })
  @ApiQuery({ name: 'assetCode', required: false, example: 'USD', description: 'Filter by asset code' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of wallet balances',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/WalletBalanceResponseDto' },
        },
        total: { type: 'number', example: 5 },
        page: { type: 'number', example: 1 },
        limit: { type: 'number', example: 20 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid pagination or filter params',
    example: {
      statusCode: 400,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/balances/wallet/123/page/abc',
      method: 'GET',
      message: 'page must be an integer',
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found or has no balances',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/balances/wallet/invalid-wallet',
      method: 'GET',
      message: 'Wallet not found',
      error: 'Not Found',
    },
  })
  async getWalletBalances(
    @Param('walletId') walletId: string,
    @Query(ValidationPipe) pagination: PaginationDto,
    @Query(ValidationPipe) filters: BalanceFilterDto,
  ) {
    const balances = await this.balanceIndexerService.getAllBalances(walletId);

    if (!balances || balances.length === 0) {
      return { data: [], total: 0, page: pagination.page, limit: pagination.limit };
    }

    // Apply filters
    let filtered = balances;
    if (filters.assetType) {
      filtered = filtered.filter((b) => b.assetType === filters.assetType);
    }
    if (filters.assetCode) {
      filtered = filtered.filter((b) => b.assetCode === filters.assetCode);
    }

    // Apply pagination
    const start = (pagination.page - 1) * pagination.limit;
    const end = start + pagination.limit;
    const data = filtered.slice(start, end);

    return {
      data,
      total: filtered.length,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  /**
   * Gets balance for a specific wallet and asset.
   */
  @Get('wallet/:walletId/asset')
  @ApiOperation({ summary: 'Get balance for a specific asset in a wallet' })
  @ApiParam({ name: 'walletId', description: 'Wallet ID (UUID)' })
  @ApiQuery({ name: 'assetType', required: false, enum: AssetType, description: 'Asset type (NATIVE, CREDIT_ALPHANUM4, CREDIT_ALPHANUM12, LIQUIDITY_POOL_SHARES)' })
  @ApiQuery({ name: 'assetCode', required: false, example: 'USD', description: 'Asset code (required for CREDIT_ALPHANUM* types)' })
  @ApiQuery({ name: 'assetIssuer', required: false, example: 'GBUQWP3BOUZX34ZONKXRBTLNNDOWR5HLCVPL2B4XNCLJTLMUMLTSOGBM', description: 'Asset issuer (required for CREDIT_ALPHANUM* types)' })
  @ApiResponse({
    status: 200,
    description: 'Balance found',
    type: WalletBalanceResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid asset type',
    example: {
      statusCode: 400,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/balances/wallet/123/asset?assetType=INVALID',
      method: 'GET',
      message: 'assetType must be one of: NATIVE, CREDIT_ALPHANUM4, CREDIT_ALPHANUM12, LIQUIDITY_POOL_SHARES',
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Balance not found',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/balances/wallet/123/asset?assetType=NATIVE',
      method: 'GET',
      message: 'Balance not found',
      error: 'Not Found',
    },
  })
  async getWalletAssetBalance(
    @Param('walletId') walletId: string,
    @Query(ValidationPipe) queryDto: GetBalanceQueryDto,
  ) {
    const asset: Asset = {
      type: queryDto.assetType || AssetType.NATIVE,
      code: queryDto.assetCode,
      issuer: queryDto.assetIssuer,
    };

    const balance = await this.balanceIndexerService.getBalance(walletId, asset);

    if (!balance) {
      throw new NotFoundException('Balance not found');
    }

    return balance;
  }

  /**
   * Manually triggers a balance sync for a single wallet from Stellar Horizon.
   */
  @Post('wallet/:walletId/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync balances for a wallet from Stellar Horizon' })
  @ApiParam({ name: 'walletId', description: 'Wallet ID (UUID)' })
  @ApiBody({
    type: SyncBalancesDto,
    examples: {
      default: {
        value: { forceRefresh: false },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Sync completed',
    type: SyncResultResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input',
    example: {
      statusCode: 400,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/balances/wallet/123/sync',
      method: 'POST',
      message: 'forceRefresh must be a boolean',
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/balances/wallet/invalid/sync',
      method: 'POST',
      message: 'Wallet not found',
      error: 'Not Found',
    },
  })
  async syncWalletBalances(
    @Param('walletId') walletId: string,
    @Body(ValidationPipe) body: SyncBalancesDto = new SyncBalancesDto(),
  ) {
    const request: SyncBalancesRequest = {
      walletId,
      forceRefresh: body.forceRefresh || false,
    };
    return await this.balanceIndexerService.syncWalletBalances(request);
  }

  /**
   * Manually triggers a full balance sync across all active wallets.
   */
  @Post('sync-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync balances for all wallets (admin operation)' })
  @ApiResponse({
    status: 200,
    description: 'Full sync completed',
    schema: {
      type: 'object',
      properties: {
        walletsProcessed: { type: 'number', example: 10 },
        balancesUpdated: { type: 'number', example: 45 },
        mismatchesFound: { type: 'number', example: 2 },
      },
    },
  })
  async syncAllWallets() {
    return await this.balanceIndexerService.syncAllWallets();
  }

  /**
   * Reconciles a wallet's indexed balance with on-chain state.
   */
  @Post('wallet/:walletId/reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reconcile wallet balance with on-chain state' })
  @ApiParam({ name: 'walletId', description: 'Wallet ID (UUID)' })
  @ApiBody({
    type: ReconcileBalanceDto,
    examples: {
      default: {
        value: {
          assetType: 'NATIVE',
          assetCode: null,
          assetIssuer: null,
        },
      },
      credit: {
        value: {
          assetType: 'CREDIT_ALPHANUM4',
          assetCode: 'USD',
          assetIssuer: 'GBUQWP3BOUZX34ZONKXRBTLNNDOWR5HLCVPL2B4XNCLJTLMUMLTSOGBM',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Reconciliation completed',
    type: ReconciliationResultResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid asset type',
    example: {
      statusCode: 400,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/balances/wallet/123/reconcile',
      method: 'POST',
      message: 'assetType must be one of: NATIVE, CREDIT_ALPHANUM4, CREDIT_ALPHANUM12, LIQUIDITY_POOL_SHARES',
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/balances/wallet/invalid/reconcile',
      method: 'POST',
      message: 'Wallet not found',
      error: 'Not Found',
    },
  })
  async reconcileWalletBalance(
    @Param('walletId') walletId: string,
    @Body(ValidationPipe) body: ReconcileBalanceDto,
  ) {
    const asset: Asset = {
      type: body.assetType,
      code: body.assetCode,
      issuer: body.assetIssuer,
    };
    return await this.balanceIndexerService.reconcileBalance(walletId, asset);
  }

  /**
   * Reconciles all balances for all active wallets.
   */
  @Post('reconcile-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reconcile all wallet balances (admin operation)' })
  @ApiResponse({
    status: 200,
    description: 'Full reconciliation completed',
    schema: {
      type: 'object',
      properties: {
        walletsProcessed: { type: 'number', example: 10 },
        mismatchesFound: { type: 'number', example: 2 },
      },
    },
  })
  async reconcileAllBalances() {
    return await this.balanceIndexerService.reconcileAllBalances();
  }

  /**
   * Syncs balances with retry backoff
   */
  @Post('wallet/:walletId/sync-with-retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync balances with automatic retry on failure' })
  @ApiParam({ name: 'walletId', description: 'Wallet ID (UUID)' })
  @ApiBody({
    type: SyncBalancesDto,
    examples: {
      default: {
        value: { forceRefresh: false },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Sync with retry completed',
    type: SyncResultResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/balances/wallet/invalid/sync-with-retry',
      method: 'POST',
      message: 'Wallet not found',
      error: 'Not Found',
    },
  })
  async syncWithRetry(
    @Param('walletId') walletId: string,
    @Body(ValidationPipe) body: SyncBalancesDto = new SyncBalancesDto(),
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
  @ApiOperation({ summary: 'Detect stale balances for a wallet' })
  @ApiParam({ name: 'walletId', description: 'Wallet ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Stale balance detection completed',
    schema: {
      type: 'object',
      properties: {
        walletId: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174000' },
        staleAssets: { type: 'array', items: { type: 'string' }, example: ['NATIVE', 'USD/CREDIT_ALPHANUM4'] },
        staleSince: { type: 'string', example: '2024-06-24T10:00:00.000Z', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/balances/wallet/invalid/stale',
      method: 'GET',
      message: 'Wallet not found',
      error: 'Not Found',
    },
  })
  async detectStaleBalances(@Param('walletId') walletId: string) {
    return this.balanceIndexerService.detectStaleBalances(walletId);
  }
}
