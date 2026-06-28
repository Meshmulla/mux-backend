import {
  BadRequestException,
  Controller,
  Post,
  Body,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import {
  KeyManagementService,
  AuditLogQuery,
} from './key-management.service';
import type { GenerateKeyRequest, SignRequest } from './key-management.service';
import { KeyType } from './domain/key-types';
import { KeyStatisticsQuery } from './domain/key-statistics';
import {
  KeyRotationAuditService,
  QueryAuditLogsRequest,
} from './key-rotation-audit.service';
import { KeyOperation } from '../generated/prisma/client';

function parsePaginationParam(
  value: string | undefined,
  name: string,
  max = 100,
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new BadRequestException(`${name} must be a non-negative integer`);
  }
  if (name === 'limit' && n > max) {
    throw new BadRequestException(`limit must not exceed ${max}`);
  }
  return n;
}

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (value === undefined) return undefined;
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new BadRequestException(`${name} must be a valid ISO date string`);
  }
  return d;
}

/**
 * Internal controller for key management operations
 *
 * WARNING: This should be internal-only and NOT exposed to public APIs.
 * All endpoints should be protected by network policy or a separate internal
 * API key guard before reaching production.
 */
@Controller('internal/key-management')
export class KeyManagementController {
  constructor(
    private readonly keyManagementService: KeyManagementService,
    private readonly auditService: KeyRotationAuditService,
  ) {}

  /**
   * Generates a new key (internal use only)
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateKey(@Body() request: GenerateKeyRequest) {
    if (!request?.keyType) {
      throw new BadRequestException('keyType is required');
    }
    if (!Object.values(KeyType).includes(request.keyType)) {
      throw new BadRequestException(
        `Invalid keyType: "${request.keyType}". Must be one of: ${Object.values(KeyType).join(', ')}`,
      );
    }

    const result = await this.keyManagementService.generateKey(request);

    return {
      publicKey: result.publicKey,
      encryptedData: result.encryptedData,
      encryptionVersion: result.encryptionVersion,
      keyVersion: result.keyVersion,
      keyType: result.keyType,
      // Note: No private key is ever returned
    };
  }

  /**
   * Signs data without exposing private key (internal use only)
   *
   * Returns 422 if the encrypted key material cannot be decrypted.
   */
  @Post('sign')
  @HttpCode(HttpStatus.OK)
  async sign(@Body() request: SignRequest) {
    // KeyDecryptionException (422) propagates automatically through
    // NestJS HttpException handling — no try/catch needed here.
    const signature = await this.keyManagementService.sign(request);

    return {
      signature: signature.signature,
      publicKey: signature.publicKey,
      algorithm: signature.algorithm,
      timestamp: signature.timestamp,
    };
  }

  /**
   * Validates a keypair (internal use only)
   *
   * Returns 422 if the encrypted key material cannot be decrypted.
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validateKey(
    @Body()
    body: {
      publicKey: string;
      encryptedKeyMaterial: string;
      keyType: KeyType;
    },
  ) {
    const isValid = await this.keyManagementService.validateKey(
      body.publicKey,
      body.encryptedKeyMaterial,
      body.keyType,
    );

    return { valid: isValid };
  }

  /**
   * Rotates the key for a wallet, creating a successor and linking it.
   * The predecessor wallet is transitioned to ROTATING and its successorId is set.
   */
  @Post('rotate')
  @HttpCode(HttpStatus.OK)
  async rotateKey(@Body() body: { walletId: string }) {
    const result = await this.keyManagementService.rotateKey(body.walletId);

    return {
      predecessorWalletId: result.predecessorWalletId,
      successorWalletId: result.successorWalletId,
      successorPublicKey: result.successorPublicKey,
    };
  }

  /**
   * Gets in-memory audit log with optional filtering and pagination
   *
   * Query parameters:
   * - operation: Filter by operation type (GENERATE, SIGN, ROTATE, etc.)
   * - publicKey: Filter by public key
   * - success: Filter by success status (true/false)
   * - startDate: Start of date range (ISO string)
   * - endDate: End of date range (ISO string)
   * - limit: Max results (default: 100, max: 100)
   * - offset: Pagination offset (default: 0)
   */
  @Get('audit')
  async getAuditLog(
    @Query('operation') operation?: string,
    @Query('publicKey') publicKey?: string,
    @Query('success') success?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const query: AuditLogQuery = {
      operation,
      publicKey,
      success: success !== undefined ? success === 'true' : undefined,
      startDate: parseDate(startDate, 'startDate'),
      endDate: parseDate(endDate, 'endDate'),
      limit: parsePaginationParam(limit, 'limit'),
      offset: parsePaginationParam(offset, 'offset'),
    };

    const result = this.keyManagementService.getAuditLog(query);

    return {
      logs: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
    };
  }

  /**
   * Gets key management statistics
   *
   * Query parameters:
   * - startDate: ISO date string (optional)
   * - endDate: ISO date string (optional)
   * - operation: Filter by operation type (optional)
   *
   * Example: GET /internal/key-management/statistics?startDate=2024-01-01&endDate=2024-12-31
   */
  @Get('statistics')
  async getStatistics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('operation') operation?: string,
  ) {
    const query: KeyStatisticsQuery = {
      startDate: parseDate(startDate, 'startDate'),
      endDate: parseDate(endDate, 'endDate'),
      operation,
    };

    const statistics = this.keyManagementService.getStatistics(query);

    return {
      success: true,
      data: statistics,
    };
  }

  /**
   * Gets detailed key management statistics with metrics and time series
   *
   * Query parameters:
   * - startDate: ISO date string (optional)
   * - endDate: ISO date string (optional)
   * - operation: Filter by operation type (optional)
   * - includeTimeSeries: Include hourly time series data (optional, default: false)
   *
   * Example: GET /internal/key-management/statistics/detailed?includeTimeSeries=true
   */
  @Get('statistics/detailed')
  async getDetailedStatistics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('operation') operation?: string,
    @Query('includeTimeSeries') includeTimeSeries?: string,
  ) {
    const query: KeyStatisticsQuery = {
      startDate: parseDate(startDate, 'startDate'),
      endDate: parseDate(endDate, 'endDate'),
      operation,
      includeTimeSeries: includeTimeSeries === 'true',
    };

    const statistics = this.keyManagementService.getDetailedStatistics(query);

    return {
      success: true,
      data: statistics,
    };
  }

  /**
   * Queries persistent audit logs with filtering
   *
   * Query parameters:
   * - operation: Filter by operation type (GENERATE, SIGN, ROTATE, etc.)
   * - keyId: Filter by key ID
   * - publicKey: Filter by public key
   * - startDate: Start of date range (ISO string)
   * - endDate: End of date range (ISO string)
   * - success: Filter by success status (true/false)
   * - limit: Max results to return (default: 100)
   * - offset: Pagination offset (default: 0)
   *
   * Example: GET /internal/key-management/audit/persistent?operation=ROTATE&limit=50
   */
  @Get('audit/persistent')
  async getPersistentAuditLogs(
    @Query('operation') operation?: string,
    @Query('keyId') keyId?: string,
    @Query('publicKey') publicKey?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('success') success?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const query: QueryAuditLogsRequest = {
      operation: operation as KeyOperation | undefined,
      keyId,
      publicKey,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      success: success !== undefined ? success === 'true' : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    };

    const result = await this.auditService.queryAuditLogs(query);

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Gets complete rotation history for a specific key
   *
   * GET /internal/key-management/audit/rotation-history/:keyId
   */
  @Get('audit/rotation-history/:keyId')
  async getRotationHistory(@Param('keyId') keyId: string) {
    const result = await this.auditService.getRotationHistory(keyId);

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Gets audit log statistics
   *
   * Query parameters:
   * - startDate: Start of date range (ISO string)
   * - endDate: End of date range (ISO string)
   *
   * Example: GET /internal/key-management/audit/statistics?startDate=2024-01-01
   */
  @Get('audit/statistics')
  async getAuditStatistics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const stats = await this.auditService.getAuditStatistics(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );

    return {
      success: true,
      data: stats,
    };
  }
}
