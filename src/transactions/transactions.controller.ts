import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
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

@ApiTags('transactions')
@Controller('transactions')
@UseGuards(ApiKeyGuard, RateLimitGuard, FeatureFlagGuard)
@FeatureFlag('transactions_enabled')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly stellarBuildService: StellarTransactionBuildService,
  ) {}

  @ApiOperation({
    summary: 'Build an unsigned Stellar payment transaction XDR',
    description:
      'Constructs and returns an unsigned XDR envelope for a Stellar payment. The caller must sign the XDR before submitting it to the network.',
  })
  @ApiBody({ type: BuildTransactionDto })
  @ApiResponse({
    status: 201,
    description: 'Unsigned XDR envelope built successfully',
    example: {
      xdr: 'AAAAAQAAAAC...',
      sequence: '123456789',
      networkPassphrase: 'Test SDF Network ; September 2015',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid source/destination key or asset',
    example: {
      statusCode: 400,
      message: 'sourcePublicKey is not a valid Stellar public key',
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid API key',
    example: {
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @Post('build')
  @SensitiveEndpoint()
  buildTransaction(@Body() dto: BuildTransactionDto) {
    return this.stellarBuildService.buildPayment(dto);
  }

  @ApiOperation({ summary: 'Create a new transaction in PENDING state' })
  @ApiBody({ type: CreateTransactionDto })
  @ApiResponse({
    status: 201,
    description: 'Transaction created and queued in PENDING state',
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      amount: '10.5000000',
      assetType: 'CREDIT_ALPHANUM4',
      assetCode: 'USDC',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      senderWalletId: '123e4567-e89b-12d3-a456-426614174000',
      receiverWalletId: '123e4567-e89b-12d3-a456-426614174001',
      status: 'PENDING',
      stellarHash: null,
      createdAt: '2024-06-24T12:34:56.789Z',
      updatedAt: '2024-06-24T12:34:56.789Z',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — validation error or insufficient balance',
    example: {
      statusCode: 400,
      message: 'amount must be a positive decimal with up to 7 decimal places',
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid API key',
    example: {
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Sender or receiver wallet not found',
    example: {
      statusCode: 404,
      message: 'Sender wallet 123e4567-e89b-12d3-a456-426614174000 not found',
      error: 'Not Found',
    },
  })
  @Post()
  @SensitiveEndpoint()
  create(@Body() createTransactionDto: CreateTransactionDto) {
    return this.transactionsService.create(createTransactionDto);
  }

  @ApiOperation({
    summary: 'List transactions with optional filters and pagination',
  })
  @ApiQuery({
    name: 'senderWalletId',
    required: false,
    description: 'Filter by sender wallet ID',
  })
  @ApiQuery({
    name: 'receiverWalletId',
    required: false,
    description: 'Filter by receiver wallet ID',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: TransactionStatus,
    description: 'Filter by transaction status',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Maximum number of results to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    example: 0,
    description: 'Number of results to skip',
  })
  @ApiResponse({
    status: 200,
    description: 'List of matching transactions',
    example: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        amount: '10.5000000',
        assetType: 'CREDIT_ALPHANUM4',
        assetCode: 'USDC',
        senderWalletId: '123e4567-e89b-12d3-a456-426614174000',
        receiverWalletId: '123e4567-e89b-12d3-a456-426614174001',
        status: 'CONFIRMED',
        stellarHash: 'abc123...',
        createdAt: '2024-06-24T12:34:56.789Z',
      },
    ],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid API key',
    example: {
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @Get()
  findAll(
    @Query('senderWalletId') senderWalletId?: string,
    @Query('receiverWalletId') receiverWalletId?: string,
    @Query('status') status?: TransactionStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.transactionsService.findAll({
      senderWalletId,
      receiverWalletId,
      status: status as TransactionStatus,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @ApiOperation({ summary: 'List transactions for a specific wallet' })
  @ApiParam({
    name: 'walletId',
    description: 'Wallet ID to fetch transactions for',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Maximum number of results to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    example: 0,
    description: 'Number of results to skip',
  })
  @ApiResponse({
    status: 200,
    description: 'Transactions where the wallet is sender or receiver',
    example: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        amount: '10.5000000',
        assetType: 'NATIVE',
        senderWalletId: '123e4567-e89b-12d3-a456-426614174000',
        status: 'CONFIRMED',
        createdAt: '2024-06-24T12:34:56.789Z',
      },
    ],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid API key',
    example: {
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
    example: {
      statusCode: 404,
      message: 'Wallet 123e4567-e89b-12d3-a456-426614174000 not found',
      error: 'Not Found',
    },
  })
  @Get('wallet/:walletId')
  findByWallet(
    @Param('walletId') walletId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.transactionsService.findByWallet(walletId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @ApiOperation({
    summary: 'Look up a transaction by its Stellar network hash',
  })
  @ApiParam({ name: 'hash', description: 'Stellar transaction hash' })
  @ApiResponse({
    status: 200,
    description: 'Transaction matching the Stellar hash, or null if not found',
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      amount: '10.5000000',
      assetType: 'NATIVE',
      senderWalletId: '123e4567-e89b-12d3-a456-426614174000',
      status: 'CONFIRMED',
      stellarHash: 'abc123def456...',
      stellarLedger: 42000000,
      stellarFee: '100',
      createdAt: '2024-06-24T12:34:56.789Z',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid API key',
    example: {
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @Get('stellar/:hash')
  findByStellarHash(@Param('hash') hash: string) {
    return this.transactionsService.findByStellarHash(hash);
  }

  @ApiOperation({ summary: 'Get a single transaction by ID' })
  @ApiParam({ name: 'id', description: 'Transaction UUID' })
  @ApiResponse({
    status: 200,
    description: 'Transaction found',
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      amount: '10.5000000',
      assetType: 'CREDIT_ALPHANUM4',
      assetCode: 'USDC',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      senderWalletId: '123e4567-e89b-12d3-a456-426614174000',
      receiverWalletId: '123e4567-e89b-12d3-a456-426614174001',
      status: 'CONFIRMED',
      stellarHash: 'abc123def456...',
      stellarLedger: 42000000,
      stellarFee: '100',
      createdAt: '2024-06-24T12:34:56.789Z',
      updatedAt: '2024-06-24T12:35:00.000Z',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid API key',
    example: {
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Transaction not found',
    example: {
      statusCode: 404,
      message: 'Transaction 550e8400-e29b-41d4-a716-446655440000 not found',
      error: 'Not Found',
    },
  })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactionsService.findOne(id);
  }

  @ApiOperation({
    summary: 'Update the status of a transaction',
    description:
      'Advances a transaction through its lifecycle: PENDING → SUBMITTED → CONFIRMED or FAILED. Invalid transitions are rejected. Terminal states (CONFIRMED, FAILED) cannot be changed.',
  })
  @ApiParam({ name: 'id', description: 'Transaction UUID' })
  @ApiBody({ type: UpdateTransactionStatusDto })
  @ApiResponse({
    status: 200,
    description: 'Transaction status updated',
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'CONFIRMED',
      stellarHash: 'abc123def456...',
      stellarLedger: 42000000,
      stellarFee: '100',
      confirmedAt: '2024-06-24T12:35:00.000Z',
      updatedAt: '2024-06-24T12:35:00.000Z',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid or disallowed status transition',
    example: {
      statusCode: 400,
      message: 'Invalid status transition: CONFIRMED -> PENDING',
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid API key',
    example: {
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Transaction not found',
    example: {
      statusCode: 404,
      message: 'Transaction 550e8400-e29b-41d4-a716-446655440000 not found',
      error: 'Not Found',
    },
  })
  @Patch(':id/status')
  @SensitiveEndpoint()
  updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateTransactionStatusDto,
  ) {
    return this.transactionsService.updateStatus(id, updateStatusDto);
  }
}
