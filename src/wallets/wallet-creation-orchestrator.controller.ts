import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  Headers,
  ConflictException,
  NotFoundException,
  BadRequestException,
  UseGuards,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiSecurity,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiHeader,
} from '@nestjs/swagger';
import {
  WalletCreationOrchestrator,
  type CreateWalletOrchestratorRequest,
  type WalletOrchestrationResult,
  WalletOrchestrationError,
} from './wallet-creation-orchestrator.service';
import { WalletNetwork } from './domain/wallet.model';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import {
  RateLimitGuard,
  SensitiveEndpoint,
} from '../rate-limit/rate-limit.guard';

/** Enum values accepted for the `:network` path parameter. */
const VALID_NETWORKS = new Set<string>(Object.values(WalletNetwork));

/**
 * Asserts that `value` is a valid `WalletNetwork` enum member.
 * Throws `BadRequestException` with a descriptive message when it is not.
 */
function assertValidNetwork(value: string): asserts value is WalletNetwork {
  if (!VALID_NETWORKS.has(value)) {
    throw new BadRequestException(
      `network must be one of: ${Array.from(VALID_NETWORKS).join(', ')}`,
    );
  }
}

@ApiTags('wallet-orchestration')
@ApiSecurity('api-key')
@Controller('wallets/orchestration')
@UseGuards(ApiKeyGuard, RateLimitGuard)
export class WalletCreationOrchestratorController {
  constructor(
    private readonly walletCreationOrchestrator: WalletCreationOrchestrator,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // POST /wallets/orchestration/create
  // ──────────────────────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Orchestrate wallet creation',
    description:
      'Creates a new wallet for a user on the specified network using the full ' +
      'orchestration pipeline (user resolution → key generation → wallet persist → activation). ' +
      'Returns an existing wallet when the user already has one on that network. ' +
      'Supports idempotent replay via an optional `idempotencyKey` in the request body.',
  })
  @ApiHeader({
    name: 'x-request-id',
    required: false,
    description: 'Client-supplied request ID for tracing; echoed in error responses.',
    example: 'req-a1b2c3d4-e5f6-7890',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId', 'network'],
      properties: {
        userId: {
          type: 'string',
          minLength: 1,
          description: 'Internal user ID (must already exist in the system)',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
        network: {
          type: 'string',
          enum: ['MAINNET', 'TESTNET'],
          description: 'Stellar network for the wallet',
          example: 'TESTNET',
        },
        idempotencyKey: {
          type: 'string',
          description:
            'Optional client-supplied key for request deduplication. ' +
            'Replayed requests return the original response. ' +
            'Using the same key with a different userId/network returns HTTP 409.',
          example: 'idem-550e8400-e29b-41d4-a716-446655440000',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Wallet created or existing wallet returned. ' +
      '`isNewWallet` is `true` only on the first creation call; `privateKey` is only ' +
      'populated on first creation and is empty on idempotency replay.',
    schema: {
      type: 'object',
      properties: {
        wallet: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000' },
            userId: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440001' },
            publicKey: {
              type: 'string',
              example: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
            },
            network: { type: 'string', enum: ['MAINNET', 'TESTNET'], example: 'TESTNET' },
            status: {
              type: 'string',
              enum: ['PROVISIONING', 'ACTIVE', 'ROTATING', 'SUSPENDED', 'DISABLED', 'COMPROMISED'],
              example: 'ACTIVE',
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        privateKey: {
          type: 'string',
          description: 'Raw private key — only present on first creation, empty on replay.',
          example: 'SCZANGBA5RLAWOD4QBJRGD4BFHB7DLISRKVD2OEVZ4EXAAQJOPXCEKD',
        },
        isNewWallet: { type: 'boolean', example: true },
        idempotencyKey: {
          type: 'string',
          nullable: true,
          example: 'idem-550e8400-e29b-41d4-a716-446655440000',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — missing or invalid fields (userId, network).',
    schema: {
      example: {
        statusCode: 400,
        timestamp: '2026-01-01T00:00:00.000Z',
        path: '/wallets/orchestration/create',
        method: 'POST',
        message: ['userId should not be empty', 'network must be a valid enum value'],
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid API key.',
    schema: {
      example: {
        statusCode: 401,
        message: 'API key is required',
        error: 'Unauthorized',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Not found — the supplied `userId` does not exist.',
    schema: {
      example: {
        statusCode: 404,
        message: 'User with ID 550e8400-e29b-41d4-a716-446655440000 not found',
        error: 'Not Found',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description:
      'Conflict — the `idempotencyKey` was already used for a different `userId` or `network`.',
    schema: {
      example: {
        statusCode: 409,
        message: 'Idempotency key "idem-abc" was already used for a different userId or network',
        error: 'Conflict',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded.',
    schema: {
      example: {
        statusCode: 429,
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: 30,
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error — orchestration pipeline failure.',
    schema: {
      example: {
        statusCode: 500,
        message: 'Wallet creation orchestration failed',
        error: 'Internal Server Error',
      },
    },
  })
  @Post('create')
  @HttpCode(HttpStatus.OK)
  @SensitiveEndpoint()
  async createWallet(
    @Body() createWalletRequest: CreateWalletOrchestratorRequest,
    @Headers('x-request-id') requestId?: string,
  ): Promise<WalletOrchestrationResult> {
    // Explicit input validation — the global ValidationPipe covers class-validator
    // decorators on the DTO, but we guard against stale/null state here as well.
    if (!createWalletRequest?.userId?.trim()) {
      throw new BadRequestException('userId must not be empty');
    }
    if (!createWalletRequest?.network) {
      throw new BadRequestException(
        `network is required and must be one of: ${Array.from(VALID_NETWORKS).join(', ')}`,
      );
    }
    assertValidNetwork(createWalletRequest.network);

    try {
      return await this.walletCreationOrchestrator.createWallet(
        createWalletRequest,
        requestId,
      );
    } catch (error) {
      // Pass through typed HTTP exceptions unchanged
      if (error instanceof NotFoundException) throw error;
      if (error instanceof ConflictException) throw error;
      if (error instanceof BadRequestException) throw error;

      // Map orchestration-phase errors to 500 with a stable message
      if (error instanceof WalletOrchestrationError) {
        throw new InternalServerErrorException(
          `Wallet creation orchestration failed (phase: ${error.phase})`,
        );
      }

      throw new InternalServerErrorException(
        'Wallet creation orchestration failed',
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /wallets/orchestration/user/:userId/:network
  // ──────────────────────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Get wallet by user and network',
    description: 'Returns the wallet for the given user on the specified network, or 404 if none exists.',
  })
  @ApiParam({ name: 'userId', description: 'Internal user ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiParam({ name: 'network', enum: WalletNetwork, description: 'Stellar network', example: 'TESTNET' })
  @ApiResponse({
    status: 200,
    description: 'Wallet found.',
    schema: {
      example: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        userId: '550e8400-e29b-41d4-a716-446655440001',
        publicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        network: 'TESTNET',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — `network` is not a valid enum value.',
    schema: {
      example: {
        statusCode: 400,
        message: 'network must be one of: MAINNET, TESTNET',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found for the given user and network.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Wallet not found for user 550e8400-e29b-41d4-a716-446655440000 on TESTNET',
        error: 'Not Found',
      },
    },
  })
  @Get('user/:userId/:network')
  async getWalletByUser(
    @Param('userId') userId: string,
    @Param('network') network: string,
  ) {
    assertValidNetwork(network);

    const wallet = await this.walletCreationOrchestrator.getWalletByUser(
      userId,
      network as WalletNetwork,
    );

    if (!wallet) {
      throw new NotFoundException(
        `Wallet not found for user ${userId} on ${network}`,
      );
    }

    return wallet;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /wallets/orchestration/validate/:userId/:network
  // ──────────────────────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Check if a user can create a wallet on a network',
    description:
      'Returns `{ canCreate: true }` when the user has no existing wallet on the ' +
      'specified network, or `{ canCreate: false }` when one already exists.',
  })
  @ApiParam({ name: 'userId', description: 'Internal user ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiParam({ name: 'network', enum: WalletNetwork, description: 'Stellar network', example: 'TESTNET' })
  @ApiResponse({
    status: 200,
    description: 'Validation result.',
    schema: {
      type: 'object',
      properties: {
        canCreate: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — `network` is not a valid enum value.',
    schema: {
      example: {
        statusCode: 400,
        message: 'network must be one of: MAINNET, TESTNET',
        error: 'Bad Request',
      },
    },
  })
  @Get('validate/:userId/:network')
  async validateUserCanCreateWallet(
    @Param('userId') userId: string,
    @Param('network') network: string,
  ) {
    assertValidNetwork(network);

    const canCreate =
      await this.walletCreationOrchestrator.validateUserCanCreateWallet(
        userId,
        network as WalletNetwork,
      );
    return { canCreate };
  }
}
