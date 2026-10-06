// The Wikipedia race without gut: what wikirace.gut.ts does, written as a plain one-off script on
// TypeSafe's SDK. It began as an agent's version, written from the decision-model knowledge and
// wikipedia.ts alone without seeing gut, and was then aligned to make the same requests as
// wikirace.gut.ts under gut. One difference on an error path: if the server refuses a tick's
// first request (the goal and the first question), this stops where gut would split it.
// node projects/gut/examples/wikirace.plain.ts
import { APIError, choice, type EntryType, TypeSafeClient } from '@typesafe-ai/sdk';
import { readArticle } from './wikipedia.ts';

const from = 'Banana';
const target = 'Roman Empire';
const goal = `The current article is "${target}"`;
const OPEN_LINK = 'Open a link on the current article';
const path = [from]; // the articles visited, by their real titles
let inputTokens = 0;
let requests = 0;

type Question = { instructions: string; criteria: Record<string, string> };

const client = new TypeSafeClient({
  baseURL: 'http://localhost:11434',
  apiKey: 'ollama',
  defaultModel: 'clef-flash',
  retry: { maxRetries: 0 }, // gut doesn't retry, so neither does this
  timeout: 300_000, // nor time out: the SDK's 10 s default cuts off a big request on clef-flash
});

const finish = (outcome: string): never => {
  process.stderr.write(`${outcome}  ${inputTokens} input tokens in ${requests} requests\n`);
  process.exit();
};

const asOptions = (options: string[]) =>
  Object.fromEntries(options.map((option, i) => [`o${i + 1}`, option]));

// Asks the decision model; undefined when the request is too large for it.
const ask = async (state: EntryType, questions: Record<string, Question>) => {
  if (inputTokens >= 50_000) finish('halted: budget');
  try {
    const { answers, usage } = await client.systemOne({
      state,
      questions: Object.fromEntries(
        Object.entries(questions).map(([key, { instructions, criteria }]) => [
          key,
          choice(instructions, criteria),
        ]),
      ),
    });
    inputTokens += usage.input_tokens;
    requests += 1;
    return answers;
  } catch (error) {
    const isTooLarge =
      error instanceof APIError &&
      (error.status === 413 || (error.status === 400 && error.message.includes('context')));
    if (isTooLarge) return;
    throw error;
  }
};

// Picks one of `options`. Too large for one request: each half picks its best, then the two winners.
const choose = async (
  state: EntryType,
  instructions: string,
  options: string[],
): Promise<{ index: number; probability: number }> => {
  if (options.length === 1) return { index: 0, probability: 1 };
  const answers = await ask(state, { next: { instructions, criteria: asOptions(options) } });
  if (answers === undefined) {
    if (options.length <= 2) throw new Error('a pair of options too large to ask');
    const middle = Math.ceil(options.length / 2);
    const first = await choose(state, instructions, options.slice(0, middle));
    const second = await choose(state, instructions, options.slice(middle));
    const final = await choose(state, instructions, [
      options[first.index] ?? '',
      options[middle + second.index] ?? '',
    ]);
    return { ...final, index: final.index === 0 ? first.index : middle + second.index };
  }
  const next = answers.next;
  if (next === undefined) throw new Error('no answer');
  return {
    index: Number(next.choice.slice(1)) - 1,
    probability: next.probabilities[next.choice] ?? 0,
  };
};

// Links cut into at most 26 bundles; each option lists every link its bundle holds.
const bundlesOf = (links: string[]) => {
  const size = Math.ceil(links.length / 26);
  return Array.from({ length: Math.ceil(links.length / size) }, (_, i) =>
    links.slice(i * size, (i + 1) * size),
  );
};
const contentsOf = (bundle: string[]) => `Contains: ${bundle.join(', ')}`;

// Picks a link: among the links if they fit one question, else among bundles that each list every
// link they hold, then inside the chosen bundle.
const pickLink = async (
  state: EntryType,
  links: string[],
  probabilities: number[],
): Promise<{ link: string; probabilities: number[] }> => {
  const instructions = `Current action: ${OPEN_LINK}. Which one?`;
  if (links.length <= 26) {
    const { index, probability } = await choose(state, instructions, links);
    return { link: links[index] ?? '', probabilities: [...probabilities, probability] };
  }
  const bundles = bundlesOf(links);
  const { index, probability } = await choose(state, instructions, bundles.map(contentsOf));
  return pickLink(state, bundles[index] ?? [], [...probabilities, probability]);
};

for (let tick = 1; ; tick++) {
  const started = performance.now();
  const tokensBefore = inputTokens;
  const log = (step: string, probabilities: number[]) =>
    process.stderr.write(
      `tick ${tick}  ${step}  ${probabilities.map(p => p.toFixed(2)).join('/')}  ${((performance.now() - started) / 1000).toFixed(1)}s  ${inputTokens - tokensBefore} input tokens\n`,
    );

  const article = await readArticle(path.at(-1) ?? from);
  path.splice(-1, 1, article.title); // a link can name a redirect; keep the real title
  const state = {
    system:
      'You are helping the user decide the next step for their wiki race by picking the most relevant link to click to reach their goal',
    goal,
    currentArticle: article.title,
  };
  const links = article.links.filter(link => !path.includes(link));
  if (links.length === 0) finish('halted: noOptions');

  // The goal rides with the tick's first question: every link when they fit in one, else their
  // bundles. A lone link needs no question, so then the goal is asked alone. gut passes a lone link,
  // or its lone openLink op when there are more than 26 links, and logs it as 1.
  const isOneQuestion = links.length <= 26;
  const bundles = bundlesOf(links);
  const passed = isOneQuestion && links.length > 1 ? [] : [1];
  const answers = await ask(state, {
    achieved: {
      instructions: 'Is the goal achieved?',
      criteria: { achieved: `Goal achieved: ${goal}`, notYet: 'Goal not achieved yet' },
    },
    ...(links.length > 1
      ? {
          next: isOneQuestion
            ? {
                instructions: 'What should happen next?',
                criteria: asOptions(links.map(link => `${OPEN_LINK} › ${link}`)),
              }
            : {
                instructions: `Current action: ${OPEN_LINK}. Which one?`,
                criteria: asOptions(bundles.map(contentsOf)),
              },
        }
      : {}),
  });
  if (answers === undefined) throw new Error('the first request is too large');
  if (answers.achieved?.choice === 'achieved') {
    log('achieved', [...passed, answers.achieved.probabilities.achieved ?? 0]);
    finish('achieved');
  }

  const next = answers.next;
  const { link, probabilities } = await (async () => {
    if (next === undefined) return { link: links[0] ?? '', probabilities: passed };
    const index = Number(next.choice.slice(1)) - 1;
    const picked = [...passed, next.probabilities[next.choice] ?? 0];
    if (isOneQuestion) return { link: links[index] ?? '', probabilities: picked };
    return pickLink(state, bundles[index] ?? [], picked);
  })();
  log(`openLink(${JSON.stringify(link)})`, probabilities);
  path.push(link);
}
