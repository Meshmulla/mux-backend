import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiSecurity,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { TransactionQueryService } from './transaction-query.service';
import { StellarTransactionBuildService } from './stellar-transaction-build.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionStatusDto } from './dto/update-transaction.dto';
import { BuildTransactionDto } from './dto/build-transaction.dto';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import {
  RateLimitGuard,
  SensitiveEndpoint,
} from '../rate-limit/rate-limit.guard';
import {
  FeatureFlagGuard,
  FeatureFlag,
} from '../common/feature-flags/feature-flag.guard';
import { TransactionStatus } from './domain/transaction.model';
import { PaginationQuery } from '../common/pagination/pagination.util';

/** Parse a pagination query param, throwing 400 on invalid input */
function parsePaginationParam(
  value: string | undefined,
  name: string,
  max = 100,
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new BadRequestException(
      `${name} must be a non-negative integer`,
    );
  }
  if (name === 'limit' && n > max) {
    throw new BadRequestException(`limit must not exceed ${max}`);
  }
  return n;
}

@Controller('transactions')
@UseGuards(ApiKeyGuard, RateLimitGuard, FeatureFlagGuard)
@FeatureFlag('transactions_enabled')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly queryService: TransactionQueryService,
    private readonly stellarBuildService: StellarTransactionBuildService,
  ) {}

  /**
   * Build an unsigned Stellar payment transaction XDR.
   * The returned XDR must be signed before submission to the network.
   */
  @ApiOperation({ summary: 'Build an unsigned Stellar payment transaction XDR' })
  @ApiBody({
    description: 'Payment build parameters',
    examples: {
      native: {
        summary: 'Native XLM payment',
        value: {
          sourcePublicKey: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF',
          destinationPublicKey: 'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF',
          amount: '10.5',
          asset: { type: 'NATIVE' },
          memo: 'Payment for services',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Returns unsigned transaction XDR string' })
  @Post('build')
  @SensitiveEndpoint()
  buildTransaction(@Body() dto: BuildTransactionDto) {
    return this.stellarBuildService.buildPayment(dto);
  }

  @ApiOperation({ summary: 'Create a new transaction' })
  @ApiBody({
    description: 'Transaction creation payload',
    examples: {
      nativePayment: {
        summary: 'Native XLM payment',
        value: {
          amount: '10',
          asset: { type: 'NATIVE' },
          senderWalletId: '550e8400-e29b-41d4-a716-446655440000',
          receiverWalletId: '550e8400-e29b-41d4-a716-446655440001',
          memo: 'Payment for invoice #42',
          idempotencyKey: 'inv-42-pay-1',
        },
      },
      usdcPayment: {
        summary: 'USDC payment',
        value: {
          amount: '25.00',
          asset: {
            type: 'CREDIT_ALPHANUM4',
            code: 'USDC',
            issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          },
          senderWalletId: '550e8400-e29b-41d4-a716-446655440000',
          receiverWalletId: '550e8400-e29b-41d4-a716-446655440001',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Transaction created in PENDING state' })
  @Post()
  @SensitiveEndpoint()
  create(@Body() createTransactionDto: CreateTransactionDto) {
    return this.transactionsService.create(createTransactionDto);
  }

  @ApiOperation({ summary: 'List transactions with optional filters and pagination' })
  @ApiQuery({ name: 'senderWalletId', required: false, description: 'Filter by sender wallet ID' })
  @ApiQuery({ name: 'receiverWalletId', required: false, description: 'Filter by receiver wallet ID' })
  @ApiQuery({ name: 'status', required: false, enum: TransactionStatus, description: 'Filter by transaction status' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max records to return (1-100, default 20)', example: 20 })
  @ApiQuery({ name: 'offset', required: false, description: 'Number of records to skip (default 0)', example: 0 })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of transactions',
    schema: {
      example: {
        data: [
          {
            id: '550e8400-e29b-41d4-a716-446655440002',
            amount: '10',
            assetType: 'NATIVE',
            status: 'PENDING',
            senderWalletId: '550e8400-e29b-41d4-a716-446655440000',
            receiverWalletId: '550e8400-e29b-41d4-a716-446655440001',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
    },
  })
  @Get()
  findAll(
    @Query('senderWalletId') senderWalletId?: string,
    @Query('receiverWalletId') receiverWalletId?: string,
    @Query('status') status?: TransactionStatus,
    @Query() pagination?: PaginationQuery,
    @Query('assetType') assetType?: string,
    @Query('assetCode') assetCode?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('createdAfter') createdAfter?: string,
    @Query('createdBefore') createdBefore?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.queryService.findAll({
      senderWalletId,
      receiverWalletId,
      status: status as TransactionStatus,
      page: pagination?.page,
      limit: pagination?.limit,
      limit: parsePaginationParam(limit, 'limit'),
      offset: parsePaginationParam(offset, 'offset'),
    });
  }

  @ApiOperation({ summary: 'List transactions for a specific wallet' })
  @ApiParam({ name: 'walletId', description: 'Wallet ID to query transactions for', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max records to return (1-100, default 20)', example: 20 })
  @ApiQuery({ name: 'offset', required: false, description: 'Number of records to skip (default 0)', example: 0 })
  @ApiResponse({ status: 200, description: 'Paginated list of wallet transactions' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @Get('wallet/:walletId')
  findByWallet(
    @Param('walletId') walletId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.transactionsService.findByWallet(walletId, {
      limit: parsePaginationParam(limit, 'limit'),
      offset: parsePaginationParam(offset, 'offset'),
    });
  }

  @ApiOperation({ summary: 'Find a transaction by Stellar transaction hash' })
  @ApiParam({ name: 'hash', description: 'Stellar transaction hash', example: 'a1b2c3d4e5f6...' })
  @ApiResponse({ status: 200, description: 'Transaction found' })
  @ApiResponse({ status: 200, description: 'Returns null if not found' })
  @Get('stellar/:hash')
  findByStellarHash(@Param('hash') hash: string) {
    return this.queryService.findByStellarHash(hash);
  }

  @ApiOperation({ summary: 'Get a transaction by ID' })
  @ApiParam({ name: 'id', description: 'Transaction UUID', example: '550e8400-e29b-41d4-a716-446655440002' })
  @ApiResponse({ status: 200, description: 'Transaction found' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.queryService.findOne(id);
  }

  @ApiOperation({ summary: 'Update transaction status' })
  @ApiParam({ name: 'id', description: 'Transaction UUID' })
  @ApiBody({
    description: 'Status update payload',
    examples: {
      submit: {
        summary: 'Mark as submitted to Stellar',
        value: {
          status: 'SUBMITTED',
          stellarHash: 'a1b2c3d4e5f6789abc...',
        },
      },
      confirm: {
        summary: 'Mark as confirmed on-chain',
        value: {
          status: 'CONFIRMED',
          stellarHash: 'a1b2c3d4e5f6789abc...',
          stellarLedger: 48750123,
          stellarFee: '100',
        },
      },
      fail: {
        summary: 'Mark as failed',
        value: {
          status: 'FAILED',
          statusReason: 'Insufficient fee',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Status updated' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  @Patch(':id/status')
  @SensitiveEndpoint()
  updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateTransactionStatusDto,
  ) {
    return this.transactionsService.updateStatus(id, updateStatusDto);
  }
}
