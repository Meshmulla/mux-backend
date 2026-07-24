import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { TransactionPollingService } from './transaction-polling.service';
import { CronSecretGuard } from '../common/cron/cron-secret.guard';

/**
 * Internal cron/background job endpoints for transaction management.
 * These endpoints bypass normal API key authentication and instead
 * require a shared secret header for security.
 */
@ApiTags('transactions-internal')
@Controller('transactions/internal')
@UseGuards(CronSecretGuard)
export class TransactionsInternalController {
  constructor(private readonly pollingService: TransactionPollingService) {}

  @ApiOperation({
    summary: 'Poll pending transactions for confirmation',
    description:
      'Check status of submitted transactions from Horizon and update their status. ' +
      'Requires X-Cron-Secret header with the configured cron secret. ' +
      'Internal endpoint for cron jobs or background workers.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of transactions to poll (default 100, max 1000)',
    example: 100,
  })
  @ApiResponse({
    status: 200,
    description: 'Poll completed',
    schema: {
      example: {
        processed: 10,
        confirmed: 7,
        failed: 2,
        errors: [],
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - missing or invalid X-Cron-Secret header',
  })
  @Post('poll-pending')
  pollPendingTransactions(@Query('limit') limit?: string) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 1000) : 100;
    return this.pollingService.pollPendingTransactions(parsedLimit);
  }
}
