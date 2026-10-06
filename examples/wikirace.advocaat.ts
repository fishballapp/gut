// The Wikipedia race with advocaat (an `ask.if` / `ask.choice` client for decision models) instead
// of gut: wikirace.plain.ts with its hand-written model client replaced by advocaat's `ask`. It makes
// the same requests as wikirace.gut.ts under gut, so the goal is asked as a two-option choice, as gut
// does, rather than with `ask.if`'s yes/no question. One difference on an error path: if the server
// refuses a tick's first request (the goal and the first question), this stops where gut would
// split it.
// node projects/gut/examples/wikirace.advocaat.ts
import { APIError, ask } from 'advocaat';
import { z } from 'zod';
import { readArticle } from './wikipedia.ts';

const from = 'Banana';
const target = 'Roman Empire';
const goal = `The current article is "${target}"`;
const OPEN_LINK = 'Open a link on the current article';
const path = [from]; // the articles visited, by their real titles
let inputTokens = 0;
let requests = 0;

type State = { system: string; goal: string; currentArticle: string };

const finish = (outcome: string): never => {
  process.stderr.write(`${outcome}  ${inputTokens} input tokens in ${requests} requests\n`);
  process.exit();
};

const client = {
  baseURL: 'http://localhost:11434',
  apiKey: 'ollama',
  model: 'clef-flash',
  // `ask` doesn't return the token count, so read it off each response for the budget.
  fetch: async (...request: Parameters<typeof fetch>) => {
    const response = await fetch(...request);
    if (response.ok) {
      const { usage } = z
        .object({ usage: z.object({ input_tokens: z.int().nonnegative() }) })
        .parse(await response.clone().json());
      inputTokens += usage.input_tokens;
      requests += 1;
    }
    return response;
  },
};

const asOptions = (options: string[]) =>
  Object.fromEntries(options.map((option, i) => [`o${i + 1}`, option]));

const isTooLarge = (error: unknown) =>
  error instanceof APIError &&
  (error.status === 413 || (error.status === 400 && error.message.includes('context')));

// Picks one of `options`. Too large for one request: each half picks its best, then the two winners.
const choose = async (
  state: State,
  instructions: string,
  options: string[],
): Promise<{ index: number; probability: number }> => {
  if (options.length === 1) return { index: 0, probability: 1 };
  if (inputTokens >= 50_000) finish('halted: budget');
  try {
    const { next } = await ask(
      state,
      { next: ask.choice(instructions, asOptions(options)) },
      client,
    );
    return {
      index: Number(next.choice.slice(1)) - 1,
      probability: next.probabilities[next.choice] ?? 0,
    };
  } catch (error) {
    if (!isTooLarge(error) || options.length <= 2) throw error;
  }
  const middle = Math.ceil(options.length / 2);
  const first = await choose(state, instructions, options.slice(0, middle));
  const second = await choose(state, instructions, options.slice(middle));
  const final = await choose(state, instructions, [
    options[first.index] ?? '',
    options[middle + second.index] ?? '',
  ]);
  return { ...final, index: final.index === 0 ? first.index : middle + second.index };
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
  state: State,
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
  const state: State = {
    system:
      'You are helping the user decide the next step for their wiki race by picking the most relevant link to click to reach their goal',
    goal,
    currentArticle: article.title,
  };
  const links = article.links.filter(link => !path.includes(link));
  if (links.length === 0) finish('halted: noOptions');
  if (inputTokens >= 50_000) finish('halted: budget');

  // The goal rides with the tick's first question: every link when they fit in one, else their
  // bundles. A lone link needs no question, so then the goal is asked alone. gut passes a lone link,
  // or its lone openLink op when there are more than 26 links, and logs it as 1.
  const isOneQuestion = links.length <= 26;
  const bundles = bundlesOf(links);
  const passed = isOneQuestion && links.length > 1 ? [] : [1];
  const achieved = ask.choice('Is the goal achieved?', {
    achieved: `Goal achieved: ${goal}`,
    notYet: 'Goal not achieved yet',
  });
  const firstQuestion = isOneQuestion
    ? ask.choice('What should happen next?', asOptions(links.map(link => `${OPEN_LINK} › ${link}`)))
    : ask.choice(`Current action: ${OPEN_LINK}. Which one?`, asOptions(bundles.map(contentsOf)));
  const answers =
    links.length > 1
      ? await ask(state, { achieved, next: firstQuestion }, client)
      : { ...(await ask(state, { achieved }, client)), next: undefined };
  if (answers.achieved.choice === 'achieved') {
    log('achieved', [...passed, answers.achieved.probabilities.achieved ?? 0]);
    finish('achieved');
  }

  const { next } = answers;
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
