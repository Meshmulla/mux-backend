import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { createRequestIdAwareAxios } from '../common/http/request-id-axios';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from './transactions.service';
import { TransactionStatus } from './domain/transaction.model';
import {
  mapHorizonResultToStatus,
  HorizonTransactionResult,
} from './horizon-result.mapper';

export interface PollingResult {
  processed: number;
  confirmed: number;
  failed: number;
  errors: string[];
}

@Injectable()
export class TransactionPollingService {
  private readonly logger = new Logger(TransactionPollingService.name);
  private readonly horizonUrl: string;
  private readonly http = createRequestIdAwareAxios();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {
    this.horizonUrl = this.configService.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
  }

  /**
   * Poll all pending transactions with stellar hashes and update their status
   * based on Horizon responses. Useful for periodic polling to confirm
   * transactions that were submitted but not yet confirmed.
   */
  async pollPendingTransactions(limit = 100): Promise<PollingResult> {
    const result: PollingResult = {
      processed: 0,
      confirmed: 0,
      failed: 0,
      errors: [],
    };

    // Find transactions with SUBMITTED status and a stellar hash
    const submittedTransactions = await this.prisma.transaction.findMany({
      where: {
        status: TransactionStatus.SUBMITTED,
        stellarHash: { not: null },
      },
      take: limit,
      orderBy: { submittedAt: 'asc' },
    });

    this.logger.log(
      `Starting poll of ${submittedTransactions.length} pending transactions`,
    );

    for (const tx of submittedTransactions) {
      try {
        result.processed++;

        if (!tx.stellarHash) {
          result.errors.push(
            `Transaction ${tx.id} missing stellarHash despite status SUBMITTED`,
          );
          continue;
        }

        // Query Horizon for transaction status
        const horizonResult = await this.queryHorizonTransaction(
          tx.stellarHash,
        );

        // Map Horizon result to our status
        const newStatus = mapHorizonResultToStatus(horizonResult);

        // Only update if status changed from SUBMITTED
        if (newStatus !== TransactionStatus.SUBMITTED) {
          await this.transactionsService.updateStatus(tx.id, {
            status: newStatus,
            ...(horizonResult.ledger !== undefined && {
              stellarLedger: horizonResult.ledger,
            }),
            ...(horizonResult.fee_charged !== undefined && {
              stellarFee: horizonResult.fee_charged,
            }),
          });

          if (newStatus === TransactionStatus.CONFIRMED) {
            result.confirmed++;
            this.logger.log(
              `Transaction ${tx.id} confirmed (hash: ${tx.stellarHash})`,
            );
          } else if (newStatus === TransactionStatus.FAILED) {
            result.failed++;
            this.logger.warn(
              `Transaction ${tx.id} failed (hash: ${tx.stellarHash})`,
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(
          `Error polling transaction ${tx.id}: ${message}`,
        );
        this.logger.error(
          `Failed to poll transaction ${tx.id}`,
          err,
        );
      }
    }

    this.logger.log(
      `Poll complete: processed=${result.processed}, confirmed=${result.confirmed}, failed=${result.failed}, errors=${result.errors.length}`,
    );

    return result;
  }

  /**
   * Query Horizon for a transaction by hash
   */
  private async queryHorizonTransaction(
    hash: string,
  ): Promise<HorizonTransactionResult> {
    try {
      const response = await this.http.get<HorizonTransactionResult>(
        `${this.horizonUrl}/transactions/${hash}`,
      );
      return response.data;
    } catch (err) {
      const axiosErr = err as AxiosError<any>;

      if (!axiosErr.response) {
        // Network / timeout error
        throw new ServiceUnavailableException(
          `Horizon network error: ${axiosErr.message}`,
        );
      }

      const status = axiosErr.response.status;

      if (status === 404) {
        // Transaction not found in Horizon yet (still processing or not submitted)
        // Return a result that indicates SUBMITTED status
        return { result_code: 'tx_submitted' };
      }

      if (status >= 500) {
        // Server error
        throw new ServiceUnavailableException(
          `Horizon server error (${status})`,
        );
      }

      // Client error (4xx other than 404)
      throw new BadRequestException(
        `Horizon error querying transaction ${hash}: ${status}`,
      );
    }
  }
}
