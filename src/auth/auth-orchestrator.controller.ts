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
} from '@nestjs/common';
import { Response } from 'express';
import {
  AuthOrchestrator,
  AuthenticationRequest,
  AuthenticationResult,
  AuthenticationRequestWithIdempotency,
} from './auth-orchestrator.service';
import { RefreshTokenService } from './refresh-token.service';
import { Public } from './public.decorator';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

@Controller('auth')
export class AuthOrchestratorController {
  constructor(
    private readonly authOrchestrator: AuthOrchestrator,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

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
   * Validation endpoint - checks if authentication is possible
   */
  @Get('validate/:authId')
  async validateAuthentication(@Param('authId') authId: string) {
    return { valid: true };
  }

  /**
   * Rotate a refresh token on use
   */
  @Post('refresh-tokens/rotate')
  @HttpCode(HttpStatus.OK)
  async rotateRefreshToken(
    @Body()
    request: {
      currentTokenHash: string;
      newTokenHash: string;
      expiresAt: string;
    },
  ) {
    const result = await this.refreshTokenService.rotateRefreshToken({
      currentTokenHash: request.currentTokenHash,
      newTokenHash: request.newTokenHash,
      expiresAt: new Date(request.expiresAt),
    });
    return {
      success: true,
      token: {
        id: result.id,
        userId: result.userId,
        expiresAt: result.expiresAt,
      },
    };
  }

  /**
   * Validate and rotate a refresh token (combined operation)
   */
  @Post('refresh-tokens/validate-and-rotate')
  @HttpCode(HttpStatus.OK)
  async validateAndRotateToken(
    @Body()
    request: {
      currentTokenHash: string;
      newTokenHash: string;
      expiresAt: string;
    },
  ) {
    const result = await this.refreshTokenService.validateAndRotateToken(
      request.currentTokenHash,
      request.newTokenHash,
      new Date(request.expiresAt),
    );

    if (!result) {
      return { success: false, error: 'Invalid or expired token' };
    }

    return {
      success: true,
      token: {
        id: result.id,
        userId: result.userId,
        expiresAt: result.expiresAt,
      },
    };
  }

  /**
   * Revoke a refresh token
   */
  @Post('refresh-tokens/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeRefreshToken(
    @Body() request: { tokenHash: string; reason?: string },
  ) {
    const result = await this.refreshTokenService.revokeRefreshToken({
      tokenHash: request.tokenHash,
      reason: request.reason,
    });
    return { success: true, revokedAt: result.revokedAt };
  }

  /**
   * Revoke all refresh tokens for a user
   */
  @Post('refresh-tokens/revoke-all/:userId')
  @HttpCode(HttpStatus.OK)
  async revokeUserRefreshTokens(
    @Param('userId') userId: string,
    @Body() request?: { reason?: string },
  ) {
    const result = await this.refreshTokenService.revokeUserRefreshTokens(
      userId,
      request?.reason,
    );
    return {
      success: true,
      revokedCount: result.count,
    };
  }

  /**
   * Get active refresh tokens for a user
   */
  @Get('refresh-tokens/:userId')
  async getActiveRefreshTokens(@Param('userId') userId: string) {
    const tokens = await this.refreshTokenService.getActiveRefreshTokens(
      userId,
    );
    return {
      tokens: tokens.map((t) => ({
        id: t.id,
        expiresAt: t.expiresAt,
        lastUsedAt: t.lastUsedAt,
        usageCount: t.usageCount,
      })),
    };
  }
}
