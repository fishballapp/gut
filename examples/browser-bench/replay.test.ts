import { describe, expect, it } from 'vitest';
import {
  formatReplayComparison,
  getTopOptions,
  parseTraceFile,
  type Request,
  type Response,
  replay,
} from './replay.ts';

describe('browser-bench replay', () => {
  it('parses valid trace JSON and extracts request events', () => {
    const validTraceJson = JSON.stringify({
      record: { task: 'docs-layout-a', variant: '26', rep: 1 },
      events: [
        { kind: 'log', line: 'starting task' },
        {
          kind: 'request',
          request: {
            state: { instruction: 'Navigate to rate limits', url: 'https://docs.example.com/' },
            questions: {
              choice: {
                instructions: 'Pick the best link',
                criteria: {
                  o1: 'API Reference',
                  o2: 'Guides',
                  o3: 'About',
                },
              },
            },
          },
          response: {
            answers: {
              choice: {
                choice: 'o1',
                probabilities: { o1: 0.8, o2: 0.15, o3: 0.05 },
              },
            },
            usage: { input_tokens: 450 },
          },
        },
      ],
    });

    const parsed = parseTraceFile(validTraceJson);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]?.kind).toBe('log');
    expect(parsed.events[1]?.kind).toBe('request');
  });

  it('throws ZodError on invalid trace JSON structure', () => {
    const invalidJson = JSON.stringify({
      record: {},
      events: [{ kind: 'unknown_kind', data: 123 }],
    });

    expect(() => parseTraceFile(invalidJson)).toThrow();
  });

  it('extracts top options sorted by probability descending and marks chosen', () => {
    const criteria = {
      o1: 'Option 1',
      o2: 'Option 2',
      o3: 'Option 3',
      o4: 'Option 4',
      o5: 'Option 5',
      o6: 'Option 6',
    };
    const probabilities = {
      o1: 0.1,
      o2: 0.4,
      o3: 0.05,
      o4: 0.25,
      o5: 0.15,
      o6: 0.05,
    };

    const top5 = getTopOptions(criteria, probabilities, 'o2', 5);
    expect(top5).toHaveLength(5);
    // Highest probability first: o2 (0.4), o4 (0.25), o5 (0.15), o1 (0.1), o3 or o6 (0.05)
    expect(top5[0]?.key).toBe('o2');
    expect(top5[0]?.probability).toBe(0.4);
    expect(top5[0]?.isChosen).toBe(true);

    expect(top5[1]?.key).toBe('o4');
    expect(top5[1]?.probability).toBe(0.25);
    expect(top5[1]?.isChosen).toBe(false);

    expect(top5[2]?.key).toBe('o5');
    expect(top5[3]?.key).toBe('o1');
  });

  it('formats recorded and replayed comparisons cleanly', () => {
    const request: Request = {
      state: { url: 'https://docs.example.com/' },
      questions: {
        nav: {
          instructions: 'Choose navigation item',
          criteria: {
            o1: 'Overview',
            o2: 'Rate limits',
          },
        },
      },
    };

    const recordedResponse: Response = {
      answers: {
        nav: {
          choice: 'o2',
          probabilities: { o1: 0.1, o2: 0.9 },
        },
      },
      usage: { input_tokens: 300 },
    };

    const replayedResponses = [
      {
        answers: {
          nav: {
            choice: 'o2',
            probabilities: { o1: 0.05, o2: 0.95 },
          },
        },
        inputTokens: 300,
      },
      {
        answers: {
          nav: {
            choice: 'o2',
            probabilities: { o1: 0.08, o2: 0.92 },
          },
        },
        inputTokens: 300,
      },
    ];

    const formatted = formatReplayComparison({
      requestIndex: 1,
      totalRequests: 2,
      request,
      recordedResponse,
      replayedResponses,
    });

    expect(formatted).toContain('Request 1 of 2');
    expect(formatted).toContain('Question "nav": Choose navigation item');
    expect(formatted).toContain('Recorded top 5:');
    expect(formatted).toContain('[o2] Rate limits (0.90) ← chosen');
    expect(formatted).toContain('Replay 1 (300 input tokens):');
    expect(formatted).toContain('Replay 2 (300 input tokens):');
  });
  it('replays request by POSTing model, state, and choice questions', async () => {
    const originalFetch = globalThis.fetch;
    try {
      let capturedBodyText: string | undefined;
      let capturedAuthHeader: string | null = null;
      globalThis.fetch = async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<globalThis.Response> => {
        if (typeof init?.body === 'string') capturedBodyText = init.body;
        if (init?.headers !== undefined) {
          capturedAuthHeader = new Headers(init.headers).get('authorization');
        }
        return new globalThis.Response(
          JSON.stringify({
            answers: {
              choice: {
                choice: 'o1',
                probabilities: { o1: 0.9, o2: 0.1 },
              },
            },
            usage: { input_tokens: 120 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      };

      const request: Request = {
        state: { screen: 'home' },
        questions: {
          choice: {
            instructions: 'Select next',
            criteria: { o1: 'Option 1', o2: 'Option 2' },
          },
        },
      };

      const config = {
        decisionModel: {
          endpoint: 'https://example.com/v1/systemone',
          name: 'test-model',
          apiKey: 'secret-key',
          capabilities: { image: false, choiceQuestions: { maxOptions: 26 } },
        },
      };

      const result = await replay(request, config);
      expect(result.inputTokens).toBe(120);
      expect(result.answers['choice']?.choice).toBe('o1');
      expect(capturedBodyText !== undefined ? JSON.parse(capturedBodyText) : undefined).toEqual({
        model: 'test-model',
        state: { screen: 'home' },
        questions: {
          choice: {
            type: 'choice',
            instructions: 'Select next',
            criteria: { o1: 'Option 1', o2: 'Option 2' },
          },
        },
      });
      expect(capturedAuthHeader).toBe('Bearer secret-key');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses an ultrafast trace with structured instructions and criteria', () => {
    const ultrafastJson = JSON.stringify({
      record: { task: 'saucedemo-checkout', variant: 'ultrafast', rep: 1 },
      events: [
        { kind: 'log', line: 'starting ultrafast' },
        {
          kind: 'request',
          request: {
            state: { page: { url: 'https://www.saucedemo.com/' } },
            questions: {
              operation: {
                type: 'choice',
                instructions: { goal: 'Log in', rules: 'NEXT_ACTION' },
                criteria: {
                  CLICK: 'Click an element',
                  TYPE_TEXT: 'Enter text',
                },
              },
              click_target: {
                type: 'choice',
                instructions: { goal: 'Log in', operation: 'CLICK' },
                criteria: {
                  '1': { element: '[1] Login Button', role: 'button' },
                },
              },
            },
          },
          response: {
            answers: {
              operation: { choice: 'CLICK', probabilities: { CLICK: 0.9, TYPE_TEXT: 0.1 } },
              click_target: { choice: '1', probabilities: { '1': 1.0 } },
            },
            usage: { input_tokens: 500 },
          },
        },
      ],
    });

    const parsed = parseTraceFile(ultrafastJson);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[1]?.kind).toBe('request');
  });
});
