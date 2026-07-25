export class LimitWarningEvent {
  constructor(
    public readonly walletId: string,
    public readonly limitType: string,
    public readonly limit: number,
    public readonly projected: number,
    public readonly timestamp: Date,
  ) {}
}
