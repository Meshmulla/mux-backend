export class PaymentCompletedEvent {
  constructor(
    public readonly paymentId: number,
    public readonly amount: number,
    public readonly currency: string,
    public readonly userId: number,
    public readonly timestamp: Date,
  ) {}
}
