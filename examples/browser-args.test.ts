import { secret } from '@gut.run/playwright';
import { describe, expect, it } from 'vitest';
import { parseArgs } from './browser-args.ts';

describe('browser-args', () => {
  it('parses valid url, goal, values and secrets', () => {
    const res = parseArgs([
      'https://example.com',
      'Sign in',
      'user=alice',
      '--secret',
      'pass=secret123',
      'theme=dark',
    ]);
    expect(res).toEqual({
      url: 'https://example.com',
      goal: 'Sign in',
      values: { user: 'alice', pass: secret('secret123'), theme: 'dark' },
    });
  });

  it('throws on trailing --secret', () => {
    expect(() =>
      parseArgs(['https://example.com', 'Sign in', 'user=alice', '--secret']),
    ).toThrowError(/Expected name=value after/);
  });

  it('throws on doubled --secret', () => {
    expect(() =>
      parseArgs(['https://example.com', 'Sign in', '--secret', '--secret', 'pass=secret123']),
    ).toThrowError(/Expected name=value after --secret/);
  });

  it('throws on malformed name=value pair', () => {
    expect(() => parseArgs(['https://example.com', 'Sign in', '--secret', 'badpair'])).toThrowError(
      /Expected name=value/,
    );
  });

  it('throws on missing or invalid URL or goal', () => {
    expect(() => parseArgs([])).toThrowError(/Expected a URL first/);
    expect(() => parseArgs(['not-a-url'])).toThrowError(/Expected a URL first/);
    expect(() => parseArgs(['https://example.com'])).toThrowError(/Expected a goal second/);
    expect(() => parseArgs(['https://example.com', '  '])).toThrowError(/Expected a goal second/);
  });
});
