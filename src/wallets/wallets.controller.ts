import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { RequireApiKey } from '../api-keys/decorators/require-api-key.decorator';
import { ApiKeyCtx } from '../api-keys/decorators/api-key-context.decorator';
import { ApiKeyContext } from '../api-keys/domain/api-key.model';
import { SensitiveEndpoint } from '../rate-limit/rate-limit.guard';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  create(@Body() createWalletDto: CreateWalletDto) {
    return this.walletsService.create(createWalletDto);
  }

  @Get()
  findAll(@Query('includeArchived') includeArchived?: string) {
    return this.walletsService.findAll({
      includeArchived: includeArchived === 'true',
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.walletsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateWalletDto: UpdateWalletDto) {
    return this.walletsService.update(id, updateWalletDto);
  }

  @Patch(':id/archive')
  @SensitiveEndpoint()
  archive(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.walletsService.archive(id, reason);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.walletsService.remove(id);
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
}
