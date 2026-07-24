import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server } from 'stellar-sdk';
import { Asset, AssetType, BalanceUpdate } from './domain/balance.model';
import { RequestContextService } from '../common/request-context/request-context.service';

export interface HorizonBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

@Injectable()
export class StellarHorizonService {
  private readonly logger = new Logger(StellarHorizonService.name);
  private readonly horizonUrl: string;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly retryJitterMs: number;
  private readonly server: Server;

  constructor(
    private readonly configService: ConfigService,
    private readonly requestContext: RequestContextService,
  ) {
    const horizonUrl = this.configService.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );

    this.maxRetries = this.configService.get<number>(
      'STELLAR_HORIZON_MAX_RETRIES',
      3,
    );
    this.retryBackoffMs = this.configService.get<number>(
      'STELLAR_HORIZON_RETRY_BACKOFF_MS',
      500,
    );
    this.retryJitterMs = this.configService.get<number>(
      'STELLAR_HORIZON_RETRY_JITTER_MS',
      250,
    );

    this.logger.log(`Initialized Stellar Horizon client: ${this.horizonUrl}`);
    this.server = new Server(horizonUrl, { allowHttp: false });
    this.logger.log(`Initialized Stellar Horizon client: ${horizonUrl}`);
  }

  /**
   * Helper to execute server actions with retry & backoff
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    opName: string,
  ): Promise<T> {
    const maxRetries = this.configService.get<number>('HORIZON_MAX_RETRIES', 3);
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        attempt++;
        if (attempt > maxRetries) {
          throw error;
        }
        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 15000);
        const requestId = this.requestContext.getRequestId();
        const logPrefix = requestId ? `[${requestId}] ` : '';
        this.logger.warn(
          `${logPrefix}Horizon API ${opName} failed (attempt ${attempt}/${maxRetries}). Retrying in ${Math.round(delay)}ms. Error: ${error.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Fetches account balances from Stellar Horizon
   */
  async getAccountBalances(publicKey: string): Promise<BalanceUpdate[]> {
    const requestId = this.requestContext.getRequestId();
    const logPrefix = requestId ? `[${requestId}] ` : '';
    try {
      const account = await this.executeWithRetry(
        () => this.server.loadAccount(publicKey),
        `loadAccount(${publicKey.substring(0, 8)}...)`,
      );

      // Simplified mock implementation
      const response = await this.withRetry(
        () => this.mockHorizonRequest(publicKey),
        `getAccountBalances(${publicKey.substring(0, 8)}...)`,
      );

      const balances: BalanceUpdate[] = response.balances.map((balance) => ({
        walletId: '', // Will be set by caller
        asset: this.parseAsset(balance),
      const balances: BalanceUpdate[] = account.balances.map((balance) => ({
        walletId: '',
        asset: this.parseAsset(balance as unknown as HorizonBalance),
        balance: balance.balance,
        ledgerSequence: parseInt(account.sequence, 10),
        timestamp: new Date(),
      }));

      this.logger.log(
        `${logPrefix}Fetched ${balances.length} balances for account ${publicKey.substring(0, 8)}...`,
      );
      return balances;
    } catch (error) {
      this.logger.error(
        `${logPrefix}Failed to fetch balances for account ${publicKey}:`,
        error,
      );
      throw new Error(`Horizon API request failed: ${error.message}`);
    }
  }

  /**
   * Checks if an account exists on-chain
   */
  async accountExists(publicKey: string): Promise<boolean> {
    const requestId = this.requestContext.getRequestId();
    const logPrefix = requestId ? `[${requestId}] ` : '';
    try {
      await this.withRetry(
        () => this.mockHorizonRequest(publicKey),
      await this.executeWithRetry(
        () => this.server.loadAccount(publicKey),
        `accountExists(${publicKey.substring(0, 8)}...)`,
      );
      return true;
    } catch (error) {
      if (
        error?.response?.status === 404 ||
        error?.message?.includes('404') ||
        error?.name === 'NotFoundError'
      ) {
        return false;
      }
      this.logger.error(
        `${logPrefix}Failed to check if account exists for ${publicKey}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Retries a Horizon request with exponential backoff and jitter.
   * 404s (account not found) are not retried since they are not transient.
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    operation: string,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        const isLastAttempt = attempt === this.maxRetries;
        const isRetryable = !error.message?.includes('404');

        if (isLastAttempt || !isRetryable) {
          throw error;
        }

        const delayMs = this.calculateBackoffWithJitter(attempt);
        this.logger.warn(
          `Horizon request failed for ${operation} (attempt ${attempt}/${this.maxRetries}), ` +
            `retrying in ${delayMs}ms: ${error.message}`,
        );
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * Calculates exponential backoff delay with random jitter to avoid
   * synchronized retry storms against Horizon.
   */
  private calculateBackoffWithJitter(attempt: number): number {
    const exponentialDelay = this.retryBackoffMs * Math.pow(2, attempt - 1);
    const jitter = Math.random() * this.retryJitterMs;
    return Math.round(exponentialDelay + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parses Horizon balance format to internal Asset model
   */
  private parseAsset(horizonBalance: HorizonBalance): Asset {
    switch (horizonBalance.asset_type) {
      case 'native':
        return { type: AssetType.NATIVE };

      case 'credit_alphanum4':
        return {
          type: AssetType.CREDIT_ALPHANUM4,
          code: horizonBalance.asset_code,
          issuer: horizonBalance.asset_issuer,
        };

      case 'credit_alphanum12':
        return {
          type: AssetType.CREDIT_ALPHANUM12,
          code: horizonBalance.asset_code,
          issuer: horizonBalance.asset_issuer,
        };

      case 'liquidity_pool_shares':
        return {
          type: AssetType.LIQUIDITY_POOL_SHARES,
          code: horizonBalance.asset_code,
        };

      default:
        throw new Error(`Unknown asset type: ${horizonBalance.asset_type}`);
    }
  }
}
