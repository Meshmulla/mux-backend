import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Headers,
  Query,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiSecurity,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import {
  WalletCreationOrchestrator,
  type CreateWalletOrchestratorRequest,
} from './wallet-creation-orchestrator.service';
import { WalletsService } from './wallets.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { WalletNetwork, WalletStatus } from './domain/wallet.model';
import { RequireApiKey } from '../api-keys/decorators/require-api-key.decorator';
import { ApiKeyCtx } from '../api-keys/decorators/api-key-context.decorator';
import type { ApiKeyContext } from '../api-keys/domain/api-key.model';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';

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

@ApiTags('wallets')
@ApiSecurity('api-key')
@Controller('wallets')
@UseGuards(ApiKeyGuard, RateLimitGuard)
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly walletCreationOrchestrator: WalletCreationOrchestrator,
  ) {}

  @ApiOperation({ summary: 'Create a new wallet' })
  @Post()
  create(
    @Body() createWalletDto: CreateWalletDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    const createRequest: CreateWalletOrchestratorRequest = {
      userId: createWalletDto.userId,
      network: createWalletDto.network,
      idempotencyKey: createWalletDto.idempotencyKey,
    };

    return this.walletCreationOrchestrator.createWallet(createRequest, requestId);
  }

  @ApiOperation({ summary: 'List wallets with optional filters and pagination' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by owning user ID' })
  @ApiQuery({ name: 'network', required: false, enum: WalletNetwork, description: 'Filter by network' })
  @ApiQuery({ name: 'status', required: false, enum: WalletStatus, description: 'Filter by wallet status' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max records to return (1-100, default 20)', example: 20 })
  @ApiQuery({ name: 'offset', required: false, description: 'Number of records to skip (default 0)', example: 0 })
  @Get()
  findAll(
    @Query('userId') userId?: string,
    @Query('network') network?: WalletNetwork,
    @Query('status') status?: WalletStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.walletsService.findAll({
      userId,
      network,
      status,
      limit: parsePaginationParam(limit, 'limit'),
      offset: parsePaginationParam(offset, 'offset'),
    });
  }

  @RequireApiKey()
  @Get('protected')
  async protectedEndpoint(@ApiKeyCtx() context: ApiKeyContext) {
    // context contains developer, project, and apiKey info
    return {
      message: 'This endpoint is protected by API key',
      developer: context.developer.email,
      project: context.project.name,
    };
  }

  // #185: Expose wallet status endpoint
  @Get(':id/status')
  async getWalletStatus(@Param('id') id: string) {
    return this.walletsService.getWalletStatus(id);
  }

  // #188: Activate wallet (PROVISIONING -> ACTIVE)
  @Patch(':id/activate')
  async activateWallet(@Param('id') id: string) {
    return this.walletsService.activateWallet(id);
  }

  // #189: List wallets by userId
  @Get('user/:userId')
  async findByUserId(@Param('userId') userId: string) {
    return this.walletsService.findWalletsByUserId(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.walletsService.findOne(id);
  }

  @ApiOperation({ summary: 'Update a wallet' })
  @ApiParam({ name: 'id', description: 'Wallet ID' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateWalletDto: UpdateWalletDto) {
    return this.walletsService.update(id, updateWalletDto);
  }

  @ApiOperation({ summary: 'Delete a wallet' })
  @ApiParam({ name: 'id', description: 'Wallet ID' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.walletsService.remove(id);
  }
}
