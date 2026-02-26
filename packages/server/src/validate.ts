import type { ZodType } from "zod";

/**
 * Parse `data` against a Zod schema. On failure, throws an error
 * with `statusCode: 400` so Fastify's error handler returns 400.
 */
export function validate<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join("; ");
    const err = new Error(message) as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }
  return result.data;
}
