export class LimitExceededEvent {
  constructor(
    public readonly userId: string,
    public readonly limitType: string,
    public readonly limit: number,
    public readonly attempted: number,
    public readonly timestamp: Date,
  ) {}
}
