import winston from 'winston';
import { Writable } from 'node:stream';

export interface LogCapture {
  transport: winston.transport;
  lines(): Record<string, unknown>[];
}

export function createLogCapture(): LogCapture {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    transport: new winston.transports.Stream({ stream }),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
