import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatZodIssues } from '../../../src/shared/utils/zod';

const schema = z.object({ name: z.string(), nested: z.object({ count: z.number() }) });

const failure = (input: unknown): z.ZodError => {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('expected parsing to fail');
  return result.error;
};

describe('formatZodIssues', () => {
  it('formats each issue as "path: message" using dotted paths', () => {
    const issues = formatZodIssues(failure({ name: 1, nested: { count: 'x' } }));

    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/^name: /);
    expect(issues[1]).toMatch(/^nested\.count: /);
  });

  it('labels root-level issues with the default root', () => {
    expect(formatZodIssues(failure('text'))[0]).toMatch(/^\(body\): /);
  });

  it('supports a custom root and prefix', () => {
    const issues = formatZodIssues(failure({ name: 1, nested: { count: 1 } }), {
      root: '',
      prefix: 'payload.',
    });

    expect(issues[0]).toMatch(/^payload\.name: /);
  });
});
