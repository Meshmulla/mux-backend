import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsStellarPublicKey } from '../../common/stellar/is-stellar-public-key.validator';

/** Positive decimal amount — must be > 0, e.g. "10", "0.0000001" */
const AMOUNT_REGEX = /^(?!0(\.0+)?$)\d+(\.\d{1,7})?$/;

export class BuildTransactionDto {
  /** Stellar public key of the source account */
  @ApiProperty({
    example: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF',
    description: 'Stellar public key of the source account',
  })
  @IsStellarPublicKey()
  sourcePublicKey: string;

  /** Stellar public key of the destination account */
  @ApiProperty({
    example: 'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF',
    description: 'Stellar public key of the destination account',
  })
  @IsStellarPublicKey()
  destinationPublicKey: string;

  /** Amount to send (string for precision, e.g. "10.5000000") */
  @ApiProperty({ example: '10.5000000' })
  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'amount must be a positive decimal with up to 7 decimal places',
  })
  amount: string;

  /**
   * Asset to send.
   * Use "native" for XLM, or provide code + issuer for a custom asset.
   */
  @ApiProperty({ example: 'native', description: '"native" for XLM, or an asset code' })
  @IsString()
  @IsNotEmpty()
  assetCode: string; // "native" | "USDC" | etc.

  /** Required when assetCode !== "native" */
  @ApiProperty({ required: false, description: 'Required when assetCode is not "native"' })
  @ValidateIf((o) => o.assetCode !== 'native')
  @IsStellarPublicKey()
  assetIssuer?: string;

  /** Optional memo text (max 28 bytes) */
  @ApiProperty({ required: false, example: 'Payment for services' })
  @IsOptional()
  @IsString()
  @MaxLength(28)
  memo?: string;

  /** Network: "TESTNET" | "MAINNET" */
  @ApiProperty({ enum: ['TESTNET', 'MAINNET'], example: 'TESTNET' })
  @IsIn(['TESTNET', 'MAINNET'])
  network: 'TESTNET' | 'MAINNET';
}

export class BuildTransactionResponseDto {
  /** Base64-encoded XDR of the unsigned transaction envelope */
  xdr: string;

  /** Source account sequence number used */
  sequence: string;

  /** Network passphrase used */
  networkPassphrase: string;
}
