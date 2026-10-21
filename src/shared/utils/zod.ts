import type { ZodError } from 'zod';

const formatPath = (path: readonly PropertyKey[], root: string): string =>
  path.length > 0 ? path.map(String).join('.') : root;

export function formatZodIssues(error: ZodError, options: { root?: string; prefix?: string } = {}): string[] {
  const { root = '(body)', prefix = '' } = options;
  return error.issues.map((issue) => `${prefix}${formatPath(issue.path, root)}: ${issue.message}`);
}
