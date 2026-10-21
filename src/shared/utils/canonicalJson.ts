import type { JsonValue } from '../types/json';

// Key order must not change the output, otherwise equal values hash differently.
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
