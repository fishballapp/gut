import { describe, expect, it } from 'vitest';
import { parseTrace, renderPage } from './visualize.ts';

const record = {
  task: 'docs-layout-a',
  variant: '26',
  rep: 1,
  success: false,
  status: 'halted',
  usage: { requests: 2, inputTokens: 900 },
  wallClockMs: 1200,
};
const request = {
  state: { goal: 'reach the page', page: { url: 'http://localhost/', title: 'Docs' } },
  questions: {
    next: {
      instructions: 'What should happen next?',
      criteria: { o1: 'Open link "A"', o2: 'Open link "B"' },
    },
  },
};

describe('visualize', () => {
  it('draws a run whose model refused one request beside one it answered', () => {
    const trace = parseTrace({
      record,
      events: [
        { kind: 'request', request, response: { status: 413, text: 'request body too large' } },
        {
          kind: 'request',
          request,
          response: {
            answers: { next: { choice: 'o2', probabilities: { o1: 0.2, o2: 0.8 } } },
            usage: { input_tokens: 450 },
          },
        },
        { kind: 'log', line: 'round 1  link_b  0.80  0.5s  450 input tokens' },
      ],
    });

    const page = renderPage([{ id: 'run', trace }]);

    expect(page).toContain('refused 413: request body too large');
    expect(page).toContain('Open link &quot;B&quot;');
    expect(page).toContain('450 tokens');
  });
  it('draws an ultrafast run with structured criteria objects and instructions dict', () => {
    const ultrafastTrace = parseTrace({
      record: {
        task: 'saucedemo-checkout',
        variant: 'ultrafast',
        rep: 1,
        success: true,
        status: 'done',
        usage: { requests: 1, inputTokens: 500 },
        wallClockMs: 2000,
      },
      events: [
        {
          kind: 'request',
          request: {
            state: { page: { url: 'https://www.saucedemo.com/', title: 'Swag Labs' } },
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
        { kind: 'log', line: 'round 1 click:login' },
      ],
    });

    const page = renderPage([{ id: 'uf-run', trace: ultrafastTrace }]);
    expect(page).toContain('Click an element');
    expect(page).toContain('ultrafast');
    expect(page).toContain('round 1 click:login');
    expect(page).toContain('[1] Login Button');
    expect(page).toContain('1.00');
  });
});
