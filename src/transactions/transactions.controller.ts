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
import { FeatureFlagGuard, FeatureFlag } from '../common/feature-flags/feature-flag.guard';
import { TransactionStatus } from './domain/transaction.model';

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
    private readonly stellarBuildService: StellarTransactionBuildService,
  ) {}

  /**
   * Build an unsigned Stellar payment transaction XDR.
   * The returned XDR must be signed before submission to the network.
   */
  @Post('build')
  @SensitiveEndpoint()
  buildTransaction(@Body() dto: BuildTransactionDto) {
    return this.stellarBuildService.buildPayment(dto);
  }

  @Post()
  @SensitiveEndpoint()
  create(@Body() createTransactionDto: CreateTransactionDto) {
    return this.transactionsService.create(createTransactionDto);
  }

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
      limit: parsePaginationParam(limit, 'limit'),
      offset: parsePaginationParam(offset, 'offset'),
    });
  }

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

  @Get('stellar/:hash')
  findByStellarHash(@Param('hash') hash: string) {
    return this.transactionsService.findByStellarHash(hash);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactionsService.findOne(id);
  }

  @Patch(':id/status')
  @SensitiveEndpoint()
  updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateTransactionStatusDto,
  ) {
    return this.transactionsService.updateStatus(id, updateStatusDto);
  }
}
