import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { cleanupResources, terminateChildProcess } from './ultrafast.ts';

describe('ultrafast cleanupResources', () => {
  it('kills and awaits python and chromium first, then stops daemon, then removes profile, then closes server', async () => {
    const events: string[] = [];
    const fakePython = new EventEmitter() as unknown as ChildProcess;
    const fakeChrome = new EventEmitter() as unknown as ChildProcess;
    const fakeServer = {
      close: async () => {
        events.push('server:close');
      },
    };

    await cleanupResources({
      pythonProcess: fakePython,
      chromeProcess: fakeChrome,
      buName: 'test-bu',
      userDataDir: '/tmp/test-profile',
      server: fakeServer,
      killProcess: async proc => {
        if (proc === fakePython) events.push('kill:python');
        if (proc === fakeChrome) events.push('kill:chrome');
      },
      stopDaemon: name => {
        events.push(`daemon:stop:${name}`);
      },
      removeDir: dir => {
        events.push(`profile:remove:${dir}`);
      },
    });

    expect(events.indexOf('kill:python')).toBeLessThan(events.indexOf('daemon:stop:test-bu'));
    expect(events.indexOf('kill:chrome')).toBeLessThan(events.indexOf('daemon:stop:test-bu'));
    expect(events.indexOf('daemon:stop:test-bu')).toBeLessThan(
      events.indexOf('profile:remove:/tmp/test-profile'),
    );
    expect(events.indexOf('profile:remove:/tmp/test-profile')).toBeLessThan(
      events.indexOf('server:close'),
    );
  });

  it('terminates child process with SIGKILL and awaits close event', async () => {
    const state = {
      killed: false,
      exitCode: null as number | null,
      signalReceived: undefined as string | NodeJS.Signals | number | undefined,
    };
    const emitter = new EventEmitter();
    const fakeChild = Object.assign(emitter, {
      get killed() {
        return state.killed;
      },
      get exitCode() {
        return state.exitCode;
      },
      kill(signal?: NodeJS.Signals | number): boolean {
        state.signalReceived = signal;
        state.killed = true;
        setTimeout(() => {
          state.exitCode = 137;
          emitter.emit('close');
        }, 10);
        return true;
      },
    }) as unknown as ChildProcess;

    await terminateChildProcess(fakeChild);
    expect(state.signalReceived).toBe('SIGKILL');
    expect(state.killed).toBe(true);
  });
});
