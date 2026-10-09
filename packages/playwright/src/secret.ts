/**
 * Secret value wrapping, internal access, and text/error redaction.
 */

const SECRET: unique symbol = Symbol('gut.secret');

export type Secret = { readonly [SECRET]: string };

export const secret = (value: string): Secret => ({ [SECRET]: value });

export const isSecret = (val: unknown): val is Secret =>
  typeof val === 'object' && val !== null && SECRET in val && typeof val[SECRET] === 'string';

export const readSecret = (val: Secret): string => val[SECRET];

export const REDACTED_SECRET = '[secret]';

export const createRedactor = (
  values?: Readonly<Record<string, string | Secret>>,
): ((text: string) => string) => {
  if (values === undefined) return text => text;
  const secrets = Object.values(values)
    .filter(isSecret)
    .map(s => s[SECRET])
    .filter(s => s.length > 0);
  if (secrets.length === 0) return text => text;

  const targets = Array.from(
    new Set(
      secrets.flatMap(sec => [
        sec,
        encodeURIComponent(sec),
        encodeURIComponent(sec).replaceAll('%20', '+'),
        sec.replaceAll(' ', '+'),
      ]),
    ),
  )
    .filter(s => s.length > 0)
    .toSorted((a, b) => b.length - a.length);

  return text => {
    if (text.length === 0) return text;
    return targets.reduce((acc, target) => acc.replaceAll(target, REDACTED_SECRET), text);
  };
};

export const redactError = (error: unknown, redact: (text: string) => string): unknown => {
  if (error instanceof Error) {
    error.message = redact(error.message);
    if (error.stack !== undefined) {
      error.stack = redact(error.stack);
    }
    return error;
  }
  if (typeof error === 'string') {
    return redact(error);
  }
  return error;
};
