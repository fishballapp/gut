import { describe, expect, it } from 'vitest';
import { actionErrorMessage } from './use-action.ts';

describe('actionErrorMessage', () => {
  it('says another tab answered for a 409', () => {
    expect(actionErrorMessage({ ok: false, status: 409, error: 'no decision d1 is waiting' })).toBe(
      'Answered in another tab',
    );
  });

  it('shows the CLI’s own text for anything else', () => {
    expect(
      actionErrorMessage({
        ok: false,
        status: 400,
        error: 'missing answer for question "achieved"',
      }),
    ).toBe('missing answer for question "achieved"');
  });
});
