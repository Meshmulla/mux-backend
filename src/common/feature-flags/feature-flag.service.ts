import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Check if a feature flag is enabled
   * Environment variable format: FEATURE_<FLAG_NAME>=true|false
   * Example: FEATURE_TRANSACTIONS_ENABLED=true
   */
  isEnabled(flagName: string): boolean {
    const envVarName = `FEATURE_${flagName.toUpperCase()}`;
    const value = this.configService.get<string>(envVarName);

    // Default to false if not set
    if (value === undefined) {
      this.logger.debug(`Feature flag ${flagName} not set, defaulting to disabled`);
      return false;
    }

    const enabled = value.toLowerCase() === 'true';
    this.logger.debug(`Feature flag ${flagName} is ${enabled ? 'enabled' : 'disabled'}`);

    return enabled;
  }
}
