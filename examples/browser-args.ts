import { type Secret, secret } from '@gut.run/playwright';

/** `name=value`, split at the first `=`. */
export const parsePair = (input: string): readonly [string, string] => {
  const at = input.indexOf('=');
  if (at <= 0) throw new Error(`Expected name=value, got "${input}"`);
  return [input.slice(0, at).trim(), input.slice(at + 1)];
};

type Accumulator = {
  readonly values: Record<string, string | Secret>;
  readonly isSecretPending: boolean;
};

/** `<url> "<goal>" [name=value …] [--secret name=value …]`: every `--secret` must be followed by name=value. */
export const parseArgs = (argv: readonly string[]) => {
  const [url, goal, ...rest] = argv;
  if (url === undefined || !URL.canParse(url)) throw new Error('Expected a URL first');
  if (goal === undefined || goal.trim().length === 0) throw new Error('Expected a goal second');

  const parsed = rest.reduce<Accumulator>(
    (acc, arg) => {
      if (acc.isSecretPending) {
        if (arg === '--secret') {
          throw new Error('Expected name=value after --secret, got another --secret');
        }
        const [name, value] = parsePair(arg);
        return {
          values: { ...acc.values, [name]: secret(value) },
          isSecretPending: false,
        };
      }
      if (arg === '--secret') {
        return { ...acc, isSecretPending: true };
      }
      const [name, value] = parsePair(arg);
      return {
        values: { ...acc.values, [name]: value },
        isSecretPending: false,
      };
    },
    { values: {}, isSecretPending: false },
  );

  if (parsed.isSecretPending) {
    throw new Error('Expected name=value after trailing --secret');
  }

  return {
    url,
    goal,
    values: parsed.values,
  };
};
