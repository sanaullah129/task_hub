import { AppError } from '../../shared/errors/appErrors';

export class IdempotencyConflictError extends AppError {
  constructor(idempotencyKey: string) {
    super(
      409,
      'idempotency_conflict',
      `Idempotency key "${idempotencyKey}" was already used with a different task type or payload`,
    );
  }
}
