// A readable trace of one run: every request gut sends the decision model (the state it sees, each
// question's options, what it chose) and gut's own round lines, in the order they happened. It wraps
// `fetch` and stderr in this process only, so gut itself knows nothing of it.
import {
  describeCriterion,
  type Event,
  EventSchema,
  QuestionSchema,
  RequestSchema,
  ResponseSchema,
} from './schema.ts';

export {
  describeCriterion,
  type Event,
  EventSchema,
  QuestionSchema,
  RequestSchema,
  ResponseSchema,
};

const renderRequest = (
  n: number,
  { request, response }: Extract<Event, { kind: 'request' }>,
  previousState: string | undefined,
): string => {
  const parsed = ResponseSchema.safeParse(response);
  const answers = parsed.success ? parsed.data.answers : {};
  const state = JSON.stringify(request.state, null, 2);
  const questions = Object.entries(request.questions).map(([key, question]) => {
    const answer = answers[key];
    const options = Object.entries(question.criteria).map(([option, crit]) => {
      const description = describeCriterion(crit);
      const probability = answer?.probabilities[option];
      const mark = answer?.choice === option ? '  ← **chosen**' : '';
      const score = probability === undefined ? '' : ` (${probability.toFixed(2)})`;
      return `   ${option}. ${description}${score}${mark}`;
    });
    const instructionsStr =
      typeof question.instructions === 'string'
        ? question.instructions
        : JSON.stringify(question.instructions);
    return [`- **${key}**: ${instructionsStr}`, ...options].join('\n');
  });
  const tokens =
    parsed.success && parsed.data.usage ? `, ${parsed.data.usage.input_tokens} tokens` : '';
  return [
    `#### Request ${n}${tokens}`,
    state === previousState
      ? '_State unchanged._'
      : `<details><summary>State</summary>\n\n\`\`\`json
${state}
\`\`\`
</details>`,
    ...questions,
    ...(parsed.success ? [] : [`Response: \`${JSON.stringify(response)}\``]),
  ].join('\n\n');
};

export const recordTrace = (initialEvents?: readonly Event[]) => {
  const events: Event[] = initialEvents ? [...initialEvents] : [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const request = RequestSchema.safeParse(
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    );
    if (request.success) {
      try {
        const text = await response.clone().text();
        const body = (() => {
          try {
            return JSON.parse(text);
          } catch {
            return { status: response.status, text };
          }
        })();
        events.push({ kind: 'request', request: request.data, response: body });
      } catch {
        // Never throw from the recording; the caller must always receive the response.
      }
    }
    return response;
  };

  const originalWrite = process.stderr.write.bind(process.stderr);
  const write: typeof process.stderr.write = (
    chunk: Uint8Array | string,
    encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
    callback?: (err?: Error | null) => void,
  ): boolean => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    events.push({ kind: 'log', line: text.trimEnd() });
    if (typeof encodingOrCallback === 'function') {
      return originalWrite(chunk, encodingOrCallback);
    }
    if (typeof encodingOrCallback === 'string') {
      return originalWrite(chunk, encodingOrCallback, callback);
    }
    return originalWrite(chunk, callback);
  };
  process.stderr.write = write;

  /** The trace as markdown, under a heading naming the run. */
  const render = (title: string): string => {
    const sections = events.reduce<{ parts: string[]; requests: number; state?: string }>(
      (acc, event) => {
        if (event.kind === 'log') return { ...acc, parts: [...acc.parts, `> ${event.line}`] };
        const requests = acc.requests + 1;
        return {
          parts: [...acc.parts, renderRequest(requests, event, acc.state)],
          requests,
          state: JSON.stringify(event.request.state, null, 2),
        };
      },
      { parts: [], requests: 0 },
    );
    return [`# ${title}`, ...sections.parts].join('\n\n');
  };

  return {
    add: (event: Event) => {
      events.push(event);
    },
    render,
    events: () => [...events],
  };
};
