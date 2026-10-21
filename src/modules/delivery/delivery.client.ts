export interface WebhookRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface WebhookResponse {
  statusCode?: number;
  error?: string;
  durationMs: number;
  responseSnippet?: string;
}

export type WebhookClient = (request: WebhookRequest) => Promise<WebhookResponse>;

const SNIPPET_LENGTH = 200;

function describeError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return `timeout after ${timeoutMs} ms`;
    const cause = (error as Error & { cause?: { code?: unknown } }).cause;
    return typeof cause?.code === 'string' ? `${cause.code}: ${error.message}` : error.message;
  }
  return String(error);
}

/** Never rejects; network failures and timeouts come back as `error`. Redirects are not followed. */
export const fetchWebhookClient: WebhookClient = async ({ url, body, headers, timeoutMs }) => {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text().catch(() => '');
    return {
      statusCode: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      responseSnippet: text.slice(0, SNIPPET_LENGTH),
    };
  } catch (error) {
    return { error: describeError(error, timeoutMs), durationMs: Math.round(performance.now() - startedAt) };
  }
};
