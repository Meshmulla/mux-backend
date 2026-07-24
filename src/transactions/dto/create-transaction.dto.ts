import { MemoType } from '../../common/stellar/memo.util';

export class TransactionAssetDto {
  type: string; // AssetType enum as string
  code?: string; // e.g., "USDC" (null for native XLM)
  issuer?: string; // Issuer public key (null for native XLM)
}

export class TransactionMemoDto {
  type: MemoType;
  value?: string;
}

export class CreateTransactionDto {
  amount: string; // Stored as string for precision
  asset: TransactionAssetDto;
  senderWalletId: string;
  receiverWalletId?: string;
  memo?: TransactionMemoDto;
  metadata?: Record<string, any>;
}
