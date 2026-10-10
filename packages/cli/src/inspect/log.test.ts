import type { InspectorEvent } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import { createEventLog } from './log.ts';

const mode = (mode: 'play' | 'step'): InspectorEvent => ({ type: 'session.mode', mode });

describe('createEventLog', () => {
  it('keeps ids counting up through a clear', () => {
    const log = createEventLog();
    log.append(mode('play'));
    log.append(mode('step'));
    log.clear();
    expect(log.firstId()).toBe(2);
    expect(log.at(0)).toBeUndefined();
    expect(log.at(1)).toBeUndefined();

    log.append(mode('play'));
    expect(log.at(2)).toEqual(mode('play'));
  });

  it('calls its listeners on every append, until unsubscribed', () => {
    const log = createEventLog();
    let calls = 0;
    const unsubscribe = log.subscribe(() => {
      calls += 1;
    });
    log.append(mode('play'));
    unsubscribe();
    log.append(mode('step'));
    expect(calls).toBe(1);
  });
});
