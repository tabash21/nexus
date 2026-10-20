export class EventConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventConflictError';
  }
}

export class InvalidSentimentLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSentimentLabelError';
  }
}