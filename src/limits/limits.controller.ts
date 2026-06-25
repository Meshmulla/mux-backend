import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { LimitsService } from './limits.service';
import { SetLimitsDto } from './dto/set-limits.dto';
import {
  FeatureFlagGuard,
  FeatureFlag,
} from '../common/feature-flags/feature-flag.guard';

@ApiTags('limits')
@Controller('wallets/:walletId/limits')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('limits_api')
export class LimitsController {
  constructor(private readonly limitsService: LimitsService) {}

  @ApiOperation({ summary: 'Set wallet transaction and daily limits' })
  @ApiParam({ name: 'walletId', description: 'Wallet ID' })
  @ApiBody({
    type: SetLimitsDto,
    examples: {
      default: {
        value: {
          dailyLimit: 5000,
          perTransactionLimit: 1000,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Limits set successfully',
    example: {
      walletId: '123e4567-e89b-12d3-a456-426614174000',
      dailyLimit: 5000,
      perTransactionLimit: 1000,
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input',
    example: {
      statusCode: 400,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/wallets/123/limits',
      method: 'POST',
      message: ['dailyLimit must be positive'],
      error: 'Bad Request',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/wallets/invalid/limits',
      method: 'POST',
      message: 'Wallet not found',
      error: 'Not Found',
    },
  })
  @Post()
  setLimits(@Param('walletId') walletId: string, @Body() dto: SetLimitsDto) {
    return this.limitsService.setLimits(
      walletId,
      dto.dailyLimit,
      dto.perTransactionLimit,
    );
  }

  @ApiOperation({ summary: 'Get wallet limits' })
  @ApiParam({ name: 'walletId', description: 'Wallet ID' })
  @ApiResponse({
    status: 200,
    description: 'Wallet limits retrieved successfully',
    example: {
      walletId: '123e4567-e89b-12d3-a456-426614174000',
      dailyLimit: 5000,
      perTransactionLimit: 1000,
    },
  })
  @ApiResponse({
    status: 404,
    description: 'No limits found for wallet',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/wallets/123/limits',
      method: 'GET',
      message: 'No limits found for wallet',
      error: 'Not Found',
    },
  })
  @Get()
  getLimits(@Param('walletId') walletId: string) {
    return this.limitsService.getLimits(walletId);
  }

  @ApiOperation({ summary: 'Remove wallet limits' })
  @ApiParam({ name: 'walletId', description: 'Wallet ID' })
  @ApiResponse({
    status: 204,
    description: 'Limits removed successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'No limits found for wallet',
    example: {
      statusCode: 404,
      timestamp: '2024-06-24T12:34:56.789Z',
      path: '/wallets/123/limits',
      method: 'DELETE',
      message: 'No limits found for wallet 123',
      error: 'Not Found',
    },
  })
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  removeLimits(@Param('walletId') walletId: string) {
    return this.limitsService.removeLimits(walletId);
  }
}
