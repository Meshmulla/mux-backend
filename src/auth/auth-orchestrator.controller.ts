import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  Headers,
  Req,
  Res,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiHeader,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  AuthOrchestrator,
  type AuthenticationRequest,
  type AuthenticationRequestWithIdempotency,
} from './auth-orchestrator.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { Public } from './public.decorator';
import { AuthSessionFilterDto } from './dto/auth-session-filter.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  FeatureFlagGuard,
  FeatureFlag,
} from '../common/feature-flags/feature-flag.guard';

@ApiTags('auth')
@Controller('auth')
@FeatureFlag('auth_api')
@UseGuards(FeatureFlagGuard)
export class AuthOrchestratorController {
  constructor(
    private readonly authOrchestrator: AuthOrchestrator,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  /**
   * Main authentication endpoint - handles both first-time and returning users.
   *
   * - Creates user + wallet atomically on first authentication.
   * - Returns existing user + wallet for returning users.
   * - All operations are idempotent.
   * - Supports optional Idempotency-Key header for request deduplication.
   * - Protected by per-IP rate limiting to prevent brute force attacks.
   */
  @ApiOperation({
    summary: 'Authenticate a user',
    description:
      'Handles first-time and returning user authentication. ' +
      'Creates a user record and wallet on first login; returns existing records on repeat calls. ' +
      'Supports idempotent replay via the Idempotency-Key header.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Client-supplied unique key for request deduplication. Replayed requests return the ' +
      'original response with the Idempotency-Replayed: true header.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['authId'],
      properties: {
        authId: {
          type: 'string',
          description: 'External auth provider user identifier (e.g. OAuth sub claim)',
          example: 'google|1234567890',
        },
        email: {
          type: 'string',
          format: 'email',
          description: 'User email address (optional)',
          example: 'alice@example.com',
        },
        displayName: {
          type: 'string',
          description: 'Human-readable display name (optional)',
          example: 'Alice Smith',
        },
        authProvider: {
          type: 'string',
          description: 'Authentication provider identifier',
          example: 'GOOGLE',
        },
        network: {
          type: 'string',
          enum: ['MAINNET', 'TESTNET'],
          description: 'Stellar network for wallet creation (defaults to TESTNET)',
          example: 'TESTNET',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Authentication successful. Returns the user and their wallet.',
    schema: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            authId: { type: 'string', example: 'google|1234567890' },
            email: { type: 'string', nullable: true, example: 'alice@example.com' },
            displayName: { type: 'string', nullable: true, example: 'Alice Smith' },
            status: { type: 'string', example: 'ACTIVE' },
            authProvider: { type: 'string', example: 'GOOGLE' },
            lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        wallet: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            publicKey: { type: 'string', example: 'GABC...' },
            network: { type: 'string', example: 'TESTNET' },
            status: { type: 'string', example: 'ACTIVE' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        isNewUser: { type: 'boolean', example: true },
        isNewWallet: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid or missing authId, bad email format, or invalid network.',
    schema: {
      example: {
        statusCode: 400,
        message: 'Invalid authentication payload: authId is required and must be a string',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — the account is not in ACTIVE status (suspended, disabled, etc.).',
    schema: {
      example: {
        statusCode: 403,
        message: 'Account is inactive',
        error: 'Forbidden',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Too Many Requests — per-IP rate limit exceeded.',
    schema: {
      example: {
        statusCode: 429,
        message: 'Too many authentication attempts. Please try again later.',
        error: 'Too Many Requests',
      },
    },
  })
  @ApiResponse({
    status: 503,
    description:
      'Service Unavailable — an unclassified downstream failure occurred ' +
      '(e.g. database or Stellar network unreachable). The message is a ' +
      'consolidated, generic string; internal error details are never ' +
      'exposed to callers and are logged server-side only.',
    schema: {
      example: {
        statusCode: 503,
        message: 'Authentication failed. Please try again later.',
        error: 'Service Unavailable',
      },
    },
  })
  @Public()
  @Post('authenticate')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async authenticate(
    @Body() request: AuthenticationRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() httpRequest: Request,
    @Res() response: Response,
  ): Promise<void> {
    const requestWithIdempotency: AuthenticationRequestWithIdempotency = {
      ...request,
      idempotencyKey,
      ipAddress: httpRequest.ip,
      userAgent: httpRequest.headers['user-agent'],
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
  @ApiOperation({
    summary: 'List auth sessions',
    description:
      'Returns a paginated list of authenticated user sessions. ' +
      'A session entry corresponds to a user record that has completed at least one login. ' +
      'Results are sorted by lastLoginAt descending. Supports filtering by status, ' +
      'authProvider, and date range.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (starting from 1)' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (max 100)' })
  @ApiQuery({ name: 'status', required: false, enum: ['PROVISIONING', 'ACTIVE', 'RECOVERY_PENDING', 'SUSPENDED', 'DISABLED'], description: 'Filter by user account status' })
  @ApiQuery({ name: 'authProvider', required: false, example: 'GOOGLE', description: 'Filter by authentication provider' })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2024-01-01T00:00:00.000Z', description: 'Filter sessions with lastLoginAt on or after this ISO date' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2024-12-31T23:59:59.999Z', description: 'Filter sessions with lastLoginAt on or before this ISO date' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of auth sessions.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              authId: { type: 'string' },
              email: { type: 'string', nullable: true },
              displayName: { type: 'string', nullable: true },
              status: { type: 'string' },
              authProvider: { type: 'string' },
              lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        total: { type: 'integer', example: 42 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 20 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid pagination params or filter values.',
    schema: {
      example: {
        statusCode: 400,
        message: 'status must be one of: PROVISIONING, ACTIVE, RECOVERY_PENDING, SUSPENDED, DISABLED',
        error: 'Bad Request',
      },
    },
  })
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
   * Validation endpoint - checks if authentication is possible for the given authId.
   *
   * Returns `{ valid: true }` for any authId that can proceed with authentication
   * (both new users and existing active users). Returns `{ valid: false }` only
   * when the lookup itself encounters an unrecoverable error.
   */
  @ApiOperation({
    summary: 'Validate an auth ID',
    description:
      'Checks whether an authId can proceed with authentication. ' +
      'Returns valid: true for new users and existing active users. ' +
      'Returns valid: false only when a system-level lookup error occurs.',
  })
  @ApiParam({ name: 'authId', description: 'External auth provider user identifier', example: 'google|1234567890' })
  @ApiResponse({
    status: 200,
    description: 'Validation result.',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean', example: true },
      },
    },
  })
  @Get('validate/:authId')
  @UseGuards(AuthRateLimitGuard)
  async validateAuthentication(@Param('authId') authId: string) {
    const isValid = await this.authOrchestrator.validateAuthentication(authId);
    return { valid: isValid };
  }
}
