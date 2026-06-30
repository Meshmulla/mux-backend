import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRecoveryDto {
  @ApiProperty({
    description: 'Wallet ID to recover',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsNotEmpty()
  walletId: string;

  @ApiProperty({
    description: 'Requester identifier (user ID or email)',
    example: 'user_abc123',
  })
  @IsString()
  @IsNotEmpty()
  requester: string;

  @ApiPropertyOptional({
    description: 'Arbitrary metadata for the recovery request',
    example: { reason: 'lost_access', contactEmail: 'user@example.com' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
