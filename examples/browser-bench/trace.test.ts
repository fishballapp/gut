import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordTrace } from './trace.ts';

describe('recordTrace', () => {
  const originalFetch = globalThis.fetch;
  const originalStderrWrite = process.stderr.write;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalStderrWrite;
  });

  it('records non-JSON responses as { status, text } without throwing', async () => {
    const stubbedFetch = vi.fn<typeof fetch>(
      async () =>
        new Response('Request Entity Too Large', { status: 413, statusText: 'Payload Too Large' }),
    );
    globalThis.fetch = stubbedFetch;

    const trace = recordTrace();

    const requestBody = {
      state: { url: 'https://example.com' },
      questions: {
        next: {
          instructions: 'What next?',
          criteria: { o1: 'Option 1' },
        },
      },
    };

    const response = await globalThis.fetch('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(413);
    const events = trace.events();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: 'request',
      request: requestBody,
      response: { status: 413, text: 'Request Entity Too Large' },
    });
  });

  it('forwards stderr arguments and decodes Uint8Array chunks with TextDecoder', () => {
    const captured: Array<string | Uint8Array> = [];
    const originalWrite: typeof process.stderr.write = (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
      callback?: (err?: Error | null) => void,
    ): boolean => {
      captured.push(chunk);
      if (typeof encodingOrCallback === 'function') encodingOrCallback(null);
      if (typeof callback === 'function') callback(null);
      return true;
    };
    process.stderr.write = originalWrite;

    const trace = recordTrace();

    const callback = vi.fn();
    const bytes = new Uint8Array([65, 10]);
    process.stderr.write(bytes, callback);

    // verified via captured
    expect(captured).toContainEqual(bytes);
    expect(callback).toHaveBeenCalled();
    const events = trace.events();
    expect(events).toContainEqual({ kind: 'log', line: 'A' });
  });
  it('supports trace.add and renders criteria objects correctly in markdown', () => {
    const trace = recordTrace();
    trace.add({
      kind: 'request',
      request: {
        state: { page: { url: 'https://example.com' } },
        questions: {
          operation: {
            instructions: { goal: 'test' },
            criteria: {
              '1': { element: '[1] Submit' },
            },
          },
        },
      },
      response: {
        answers: {
          operation: { choice: '1', probabilities: { '1': 1.0 } },
        },
      },
    });
    trace.add({ kind: 'log', line: 'round 1 click:submit' });

    expect(trace.events()).toHaveLength(2);
    const md = trace.render('Test Run');
    expect(md).toContain('# Test Run');
    expect(md).toContain('[1] Submit');
    expect(md).toContain('> round 1 click:submit');
  });
});
