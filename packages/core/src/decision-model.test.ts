import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DecisionModel, requestAnswers } from './decision-model.ts';

const model: DecisionModel = {
  endpoint: 'https://decision.test/v1/systemone',
  name: 'test-model',
  capabilities: {
    image: false,
    choiceQuestions: { maxOptions: 255 },
  },
};

const request = {
  state: { url: 'https://example.com' },
  questions: {
    q1: {
      instructions: 'Pick an option',
      criteria: { a: 'first', b: 'second' },
    },
  },
};

const successPayload = {
  answers: {
    q1: {
      choice: 'a',
      probabilities: { a: 0.9, b: 0.1 },
    },
  },
  usage: { input_tokens: 42 },
};

describe('requestAnswers retry logic', () => {
  let previousFetch: typeof fetch | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    previousFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousFetch !== undefined) {
      globalThis.fetch = previousFetch;
    }
  });

  it('retries 503 twice and succeeds when third attempt returns 200', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return new Response('service unavailable', { status: 503 });
        }
        return new Response(JSON.stringify(successPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const promise = requestAnswers(model, request);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(callCount).toBe(3);
    expect(result.answers.q1?.choice).toBe('a');
    expect(result.inputTokens).toBe(42);
  });

  it('does not retry 400 and throws immediately', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response('bad request', { status: 400 });
      }),
    );

    const assertion = expect(requestAnswers(model, request)).rejects.toThrow(
      'decision model answered 400: bad request',
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(callCount).toBe(1);
  });

  it('retries after network error and succeeds on 200', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new TypeError('fetch failed');
        }
        return new Response(JSON.stringify(successPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const promise = requestAnswers(model, request);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.answers.q1?.choice).toBe('a');
  });

  it('throws the last error when all 4 attempts return 503', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response(`service unavailable attempt ${callCount}`, { status: 503 });
      }),
    );

    const assertion = expect(requestAnswers(model, request)).rejects.toThrow(
      'decision model answered 503: service unavailable attempt 4',
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(callCount).toBe(4);
  });

  it('retries on HTTP 429 rate limit', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('rate limited', { status: 429 });
        }
        return new Response(JSON.stringify(successPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const promise = requestAnswers(model, request);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.answers.q1?.choice).toBe('a');
  });

  it('does not retry 413 or request too large error', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response('too large', { status: 413 });
      }),
    );

    const assertion = expect(requestAnswers(model, request)).rejects.toThrow(
      'decision model answered 413: too large',
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(callCount).toBe(1);
  });

  it('retries a reply whose body drops mid-read', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const dropped = new ReadableStream({
            start: controller => controller.error(new TypeError('terminated')),
          });
          return new Response(dropped, { status: 503 });
        }
        return new Response(JSON.stringify(successPayload), { status: 200 });
      }),
    );

    const promise = requestAnswers(model, request);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.answers.q1?.choice).toBe('a');
  });
});
