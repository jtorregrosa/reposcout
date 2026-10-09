export const ExitCode = {
  Ok: 0,
  Failed: 1,
  Busy: 2,
  UsageLimit: 3,
  Cancelled: 4,
  Budget: 5,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export class UsageLimitError extends Error {
  override name = 'UsageLimitError';
}

export class CancelledError extends Error {
  override name = 'CancelledError';
}

export class ActionError extends Error {
  override name = 'ActionError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
