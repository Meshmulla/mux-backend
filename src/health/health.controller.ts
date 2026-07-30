import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Health check, including build identity (git SHA)',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      example: {
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
        build: { gitSha: 'a1b2c3d4e5f6' },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Service is unhealthy (e.g. database unreachable)',
    schema: {
      example: {
        status: 'error',
        info: {},
        error: { database: { status: 'down', message: 'connection refused' } },
        details: { database: { status: 'down', message: 'connection refused' } },
        build: { gitSha: 'a1b2c3d4e5f6' },
      },
    },
  })
  async check() {
    const build = { gitSha: this.getGitSha() };

    try {
      const result = await this.health.check([
        () => this.prismaIndicator.pingCheck('database', this.prisma),
      ]);
      return { ...result, build };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        const response = err.getResponse();
        const body =
          typeof response === 'object' && response !== null
            ? response
            : { message: response };
        throw new ServiceUnavailableException({ ...body, build });
      }
      throw err;
    }
  }

  /**
   * Git SHA of the running build, injected at container build time via the
   * GIT_SHA env var (see Dockerfile). Never sourced from anything that could
   * leak secrets — just a commit hash.
   */
  private getGitSha(): string {
    return this.configService.get<string>('GIT_SHA', 'unknown');
  }
}
