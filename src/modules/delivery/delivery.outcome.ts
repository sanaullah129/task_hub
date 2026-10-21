import type { BackoffConfig } from '../../config/config';
import { computeBackoffMs, type RandomSource } from '../../shared/utils/backoff';
import type { DeliveryResult } from '../events/event.repository';
import type { WebhookResponse } from './delivery.client';

export interface DeliveryOutcomeInput {
  response: WebhookResponse;
  /** 1-based number of the attempt that just finished. */
  attemptNumber: number;
  maxAttempts: number;
  now: Date;
  backoff: BackoffConfig;
  random?: RandomSource;
}

const isRetryableStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500;

/** 2xx delivers; network errors, timeouts, 408, 429 and 5xx retry; any other response is permanent. */
export function decideDelivery({
  response,
  attemptNumber,
  maxAttempts,
  now,
  backoff,
  random,
}: DeliveryOutcomeInput): DeliveryResult {
  const { statusCode } = response;
  if (statusCode !== undefined && statusCode >= 200 && statusCode < 300) {
    return { kind: 'delivered', deliveredAt: now };
  }

  const description = statusCode === undefined ? (response.error ?? 'unknown error') : `HTTP ${statusCode}`;
  const retryable = statusCode === undefined || isRetryableStatus(statusCode);

  if (retryable && attemptNumber < maxAttempts) {
    const delayMs = computeBackoffMs(attemptNumber, backoff, random);
    return { kind: 'retry', nextAttemptAt: new Date(now.getTime() + delayMs), lastError: description };
  }
  const why = retryable ? 'attempts exhausted' : 'permanent failure';
  return { kind: 'failed', lastError: `${description} (${why})` };
}
