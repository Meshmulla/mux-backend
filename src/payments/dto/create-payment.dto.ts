import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentDto {
  /** Sender wallet UUID — validated to exist and be ACTIVE before payment is created. */
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Sender wallet UUID - must exist and be ACTIVE',
  })
  @IsString({ message: 'walletId must be a string' })
  @IsNotEmpty({ message: 'walletId is required' })
  walletId: string;

  /** Receiver wallet UUID — validated to exist before payment is created. */
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'Receiver wallet UUID - must exist',
  })
  @IsString({ message: 'receiverWalletId must be a string' })
  @IsNotEmpty({ message: 'receiverWalletId is required' })
  receiverWalletId: string;

  @ApiProperty({
    example: 100.5,
    description: 'Payment amount - must be positive',
  })
  @IsNumber({}, { message: 'amount must be a number' })
  @IsPositive({ message: 'amount must be positive' })
  amount: number;

  @ApiProperty({
    example: 'USD',
    description: 'Currency code',
  })
  @IsString({ message: 'currency must be a string' })
  @IsNotEmpty({ message: 'currency is required' })
  currency: string;

  @ApiProperty({
    example: 'Payment for services',
    description: 'Optional payment description',
    required: false,
  })
  @IsString({ message: 'description must be a string' })
  @IsOptional()
  description?: string;

  /** Legacy sender ID (LegacyUser.id) — required for payment record FK. */
  @ApiProperty({
    example: 1,
    description: 'Legacy sender ID (LegacyUser.id)',
  })
  @IsInt({ message: 'fromId must be an integer' })
  @IsNotEmpty({ message: 'fromId is required' })
  @Min(1, { message: 'fromId must be greater than 0' })
  fromId: number;

  /** Legacy receiver ID (LegacyUser.id) — required for payment record FK. */
  @ApiProperty({
    example: 2,
    description: 'Legacy receiver ID (LegacyUser.id)',
  })
  @IsInt({ message: 'toId must be an integer' })
  @IsNotEmpty({ message: 'toId is required' })
  @Min(1, { message: 'toId must be greater than 0' })
  toId: number;
}
