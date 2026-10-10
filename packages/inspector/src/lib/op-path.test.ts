import { describe, expect, it } from 'vitest';
import { isOnPath } from './op-path.ts';

describe('isOnPath', () => {
  const picked = { keys: ['more', 'set'], choice: 3 };

  it('marks every ancestor key prefix as on the path', () => {
    expect(isOnPath({ keys: ['more'] }, picked)).toBe(true);
    expect(isOnPath({ keys: ['more', 'set'] }, picked)).toBe(true);
  });

  it('marks the picked choice and rejects siblings', () => {
    expect(isOnPath({ keys: ['more', 'set'], choice: 3 }, picked)).toBe(true);
    expect(isOnPath({ keys: ['more', 'set'], choice: 2 }, picked)).toBe(false);
  });

  it('rejects a longer key path and a sibling branch', () => {
    expect(isOnPath({ keys: ['more', 'set', 'x'] }, picked)).toBe(false);
    expect(isOnPath({ keys: ['add'] }, picked)).toBe(false);
  });

  it('treats a root op with matching keys as on the path', () => {
    expect(isOnPath({ keys: ['add'] }, { keys: ['add'] })).toBe(true);
    expect(isOnPath({ keys: ['add'] }, { keys: ['add'], choice: 0 })).toBe(true);
  });

  it('rejects a choice when the pick has no choice', () => {
    expect(isOnPath({ keys: ['add'], choice: 0 }, { keys: ['add'] })).toBe(false);
  });
});
