import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  Headers,
  Res,
  UseGuards,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AuthOrchestrator,
  type AuthenticationRequest,
  type AuthenticationRequestWithIdempotency,
} from './auth-orchestrator.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { Public } from './public.decorator';
import { AuthSessionFilterDto } from './dto/auth-session-filter.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

@Controller('auth')
export class AuthOrchestratorController {
  constructor(private readonly authOrchestrator: AuthOrchestrator) {}

  /**
   * Main authentication endpoint - handles both first-time and returning users
   *
   * This endpoint:
   * 1. Creates user if first time
   * 2. Creates wallet if first time
   * 3. Returns existing user + wallet if already exists
   *
   * All operations are idempotent.
   * Supports optional Idempotency-Key header for request deduplication.
   * Protected by per-IP rate limiting to prevent brute force attacks.
   */
  @Public()
  @Post('authenticate')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async authenticate(
    @Body() request: AuthenticationRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const requestWithIdempotency: AuthenticationRequestWithIdempotency = {
      ...request,
      idempotencyKey,
    };

    const result = await this.authOrchestrator.handleAuthentication(
      requestWithIdempotency,
    );

    // Extract and remove metadata before sending response
    const idempotencyReplayed = (result as any)._idempotencyReplayed ?? false;
    const responseBody = { ...result };
    delete (responseBody as any)._idempotencyReplayed;

    // Set idempotency-replayed header if idempotency key was provided
    if (idempotencyKey) {
      response.setHeader(
        'Idempotency-Replayed',
        idempotencyReplayed ? 'true' : 'false',
      );
    }

    response.json(responseBody);
  }

  /**
   * Sessions listing endpoint - returns recent auth sessions with optional filters.
   *
   * Supports filtering by account status, authProvider, and lastLoginAt date range.
   * Results are paginated and ordered by lastLoginAt descending.
   */
  @Get('sessions')
  listSessions(
    @Query() pagination: PaginationDto,
    @Query() filters: AuthSessionFilterDto,
  ) {
    return this.authOrchestrator.listSessions({
      page: pagination.page,
      limit: pagination.limit,
      status: filters.status,
      authProvider: filters.authProvider,
      dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
    });
  }

  /**
   * Validation endpoint - checks if authentication is possible
   */
  @Get('validate/:authId')
  async validateAuthentication(@Param('authId') authId: string) {
    const isValid = await this.authOrchestrator.validateAuthentication(authId);
    return { valid: isValid };
  }
}
