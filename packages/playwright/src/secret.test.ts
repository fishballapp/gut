import { describe, expect, it } from 'vitest';
import {
  createRedactor,
  isSecret,
  REDACTED_SECRET,
  readSecret,
  redactError,
  secret,
} from './secret.ts';

describe('secret', () => {
  it('wraps and reads secret without leaking symbol', () => {
    const s = secret('my-super-secret');
    expect(isSecret(s)).toBe(true);
    expect(isSecret('not-a-secret')).toBe(false);
    expect(isSecret(null)).toBe(false);
    expect(isSecret({})).toBe(false);
    expect(isSecret({ foo: 'bar' })).toBe(false);
    expect(readSecret(s)).toBe('my-super-secret');
  });

  it('narrows isSecret without type assertion', () => {
    const val: unknown = secret('token_123');
    if (isSecret(val)) {
      expect(readSecret(val)).toBe('token_123');
    } else {
      expect.unreachable();
    }
  });

  it('creates a redactor that replaces secret values with [secret]', () => {
    const redact = createRedactor({
      apiKey: secret('sk-123456789'),
      pass: secret('hunter2'),
      plain: 'ignore-me',
    });

    expect(redact('API key is sk-123456789 and pass is hunter2.')).toBe(
      `API key is ${REDACTED_SECRET} and pass is ${REDACTED_SECRET}.`,
    );
    expect(redact('No secrets here')).toBe('No secrets here');
  });

  it('handles undefined or empty secrets in createRedactor', () => {
    const redactor1 = createRedactor(undefined);
    expect(redactor1('hello world')).toBe('hello world');

    const redactor2 = createRedactor({});
    expect(redactor2('hello world')).toBe('hello world');

    const redactor3 = createRedactor({ empty: secret('') });
    expect(redactor3('hello world')).toBe('hello world');
  });

  it('redacts longer secrets first when secrets overlap', () => {
    const redact = createRedactor({
      short: secret('abc'),
      long: secret('abcdef'),
    });

    expect(redact('value is abcdef')).toBe(`value is ${REDACTED_SECRET}`);
  });

  it('redacts url-encoded and form-encoded representations of secrets', () => {
    const redact = createRedactor({
      token: secret('secret token?'),
    });

    const raw = 'url is https://example.com/?q=secret%20token%3F&alt=secret+token%3F';
    expect(redact(raw)).toBe(
      `url is https://example.com/?q=${REDACTED_SECRET}&alt=${REDACTED_SECRET}`,
    );
  });

  it('redacts Error messages and stack traces', () => {
    const redact = createRedactor({ pw: secret('topsecret123') });
    const err = new Error('Failed connecting with password topsecret123');
    err.stack = 'Error: Failed connecting with password topsecret123\n  at foo.js:1:1';

    const redacted = redactError(err, redact);
    expect(redacted).toBe(err);
    expect(err.message).toBe(`Failed connecting with password ${REDACTED_SECRET}`);
    expect(err.stack).toContain(`Failed connecting with password ${REDACTED_SECRET}`);
    expect(err.stack).not.toContain('topsecret123');
  });

  it('redacts string errors and passes through non-errors', () => {
    const redact = createRedactor({ pw: secret('pass456') });
    expect(redactError('Error: pass456 failed', redact)).toBe(`Error: ${REDACTED_SECRET} failed`);
    expect(redactError(12345, redact)).toBe(12345);
  });
});
