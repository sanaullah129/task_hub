import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../src/shared/utils/canonicalJson';

describe('canonicalJson', () => {
  it('sorts object keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('keeps array order and primitive types distinct', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(canonicalJson('1')).not.toBe(canonicalJson(1));
  });
});
