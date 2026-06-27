export class LimitUpdatedEvent {
  constructor(
    public readonly walletId: string,
    public readonly limitType: string,
    public readonly oldValue: number | null,
    public readonly newValue: number,
    public readonly timestamp: Date,
  ) {}
}
