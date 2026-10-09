# gut

**A non-deterministic runtime.** You write the moves. The model writes the order.

Non-deterministic as in a nondeterministic machine, or McCarthy's `amb`: at every step several
moves are legal, and something chooses one. In gut that something is a fast decision model, so the
choice is not random: the same view gives the same pick.

An agent gives gut a goal and the moves it may make. Every tick, gut shows the decision model the
goal, what the world looks like now, and the moves available. The model picks one and gut runs it,
until the goal is met (checked by the task's code, or claimed by the model when code can't check
it) or gut halts back to the agent. The model only ever *picks*: it never writes text.

> **Status:** core v0 is built: `initGut`, `op`, `group`, `gut run`, and the examples below. `gut
> task`, plugins, the JSON result on stdout and the JSONL trace are designed here but not built.
> This file is the current design; it changes in place.

## When gut fits

Ask one question: **can you write the flowchart?**

| You know… | Use |
| --- | --- |
| the steps and their order | plain code |
| the steps and their order, with a judgment at fixed points ("is this a billing ticket?") | plain code that asks a decision model at those points |
| **every move that is allowed, but not the order**: it depends on what the world shows each time | **gut** |
| not even the moves, or each step needs real reasoning or writing | a full LLM agent |

gut is for ambiguous *paths* made of easy *steps*: racing across Wikipedia, finishing a checkout on
a site you haven't seen, finding the right page in unfamiliar docs. The next move depends on what
the last one revealed, but each move is a small pick among described options. A decision model makes
each pick without generating text, cheaply and fast, and a run stops when the goal is met or halts on a stall, the budget, an error or nothing left to pick. The big model works once per
run, not once per step.

## Features

- **You write the moves; the model writes the order.** A task is ordinary TypeScript: a function
  that returns what the model reads and the moves allowed right now. gut runs the loop.
- **More options than a model can take.** Hand gut every option, at any length; the model still
  sees each one (below).
- **The goal is the finish line.** A task that can check it in code does (`isGoalAchieved`), and
  the model is never asked. Otherwise each tick's first request also asks the model whether the
  goal is met, at no extra request, and the run ends as `achieved` for the caller to check.
- **Cheap and fast.** Decision models never generate and charge only for input: Jev on OpenRouter
  answers in about 255 ms at $0.042 per million input tokens, and clef-flash runs free on a laptop.
- **Bounded.** An input-token budget, stall detection, and a result that says how the run ended and
  what it spent.
- **Any `/v1/systemone` model.** Clef on a local Ollama, TypeSafe's Jev, Jev on OpenRouter; nothing
  is tuned per model.
- **A fraction of the code.** The wiki race is 39 lines with gut and about 145 without
  ([the comparison](#a-task)).

### More options than a model can take

A decision model answers questions of a limited number of options (255 on TypeSafe's Jev, 26 on
Ollama), within a size limit per request (clef-flash on Ollama: a 16,384-token context), and every option costs it about 18 tokens of framing. A Wikipedia
article has hundreds of links; a page or a menu can have thousands of choices. Ops and `choices` can
be any length, and gut makes sure every one is within the model's reach:

- **Bundles.** A list too long for one question is asked as bundles: options that each list
  everything they hold, one per line under "Contains:", so many titles share one option's
  framing. The model picks a bundle, then an option inside it.
- **Groups.** A question opens the smallest groups while they fit; a closed group shows an
  indented outline of its first 8 moves and how many more it holds, and choosing it asks every move
  inside.
- **Split on refusal.** A question the server refuses as too large is split in half, each half picks
  its best, and the two winners are asked. Refusals aren't billed, so this needs no token counting
  and adapts to any model.

Nothing is cut, sampled or ranked away by code: a move the model never reads sits in a bundle or
group it passed over, never dropped.

## From the command line (planned)

The main use needs no script: `gut task` takes a goal, plus plugins that supply what the model sees
and can do.

**A goal is the end state you want to see**, written so it can be checked against the context: "the
page lists this month's trending repositories", not "find the top repos". A task with no code to
check it, as on the command line, leaves the model to judge it from the context.

```sh
gut task "The page lists this month's trending GitHub repositories" \
  --use-browser '{ "initialUrl": "https://github.com" }'

gut task 'The page shows flights from London to Tokyo on 3 March 2027, sorted by price' \
  --use-browser '{
    "initialUrl": "https://www.google.com/travel/flights",
    "typing": {
      "text": {
        "locations": { "lhr": "London", "tyo": "Tokyo" },
        "departure": { "humanReadable": "3 March", "iso": "2027-03-03" }
      }
    }
  }'
```

`--use-<plugin> [options]` adds a plugin, with its options as JSON. The browser opens `initialUrl` first.
`typing.text` is everything it may type into an input or a textarea; the model never invents text.
Objects nest into groups and the strings are the values, so a value can come in several formats and
the model picks the one the field wants: `browser.searchForm.date.type(departure.iso)`.
`typing.secrets` has the same shape, but only its key paths reach the model and the trace
(`browser.login.password.type(github.password)`); the values are typed and never shown.

The calling agent supplies the starting point (a URL, the text options for a search) and so settles
what an ambiguous goal means; gut does the clicking. The run prints JSON when it ends, and the
agent reads the answer from the final context and checks the claim:

```jsonc
{
  "status": "achieved", // the model claims the goal is met; or "halted", with a reason and the top options
  "steps": [
    "browser.nav.openSource.open",
    "browser.nav.openSource.trending",
    "browser.dateRange.open",
    "browser.dateRange.pick(\"This month\")"
  ],
  "context": { "goal": "…", "browser": { "url": "https://github.com/trending?since=monthly", "elements": [/* … */] } }
}
```

## A task

A script adds moves of its own. The Wikipedia race: get from one article to another by following
links only.

```ts
// wikirace.gut.ts     gut run wikirace.gut.ts
import { initGut, op } from '@gut.run/core';
import { readArticle } from './wikipedia.ts';

const target = 'Roman Empire';
const path = ['Banana'];

const { runTask } = await initGut();

await runTask(
  async () => {
    const article = await readArticle(path.at(-1) ?? '');
    path.splice(-1, 1, article.title); // a link can name a redirect; keep the real title

    return {
      context: {
        instruction:
          'You are helping the user decide the next step for their wiki race by picking the most relevant link to click to reach their goal',
        goal: `The current article is "${target}"`,
        currentArticle: article.title,
      },

      ops: {
        openLink: op('Open a link on the current article', {
          choices: article.links.filter((link) => !path.includes(link)),
          invoke: (link) => {
            path.push(link);
          },
        }),
      },
    };
  },
  { isGoalAchieved: () => path.at(-1) === target },
);
```

A run on clef-flash, one line per tick, with a probability per level: the op (1.00, the only one,
so not asked), a bundle, then a link inside it. The last tick is the title check, with no
request:

```
tick 1  openLink("Columbian exchange")  1.00/0.15/0.38  10.5s  2889 input tokens
tick 2  openLink("Christopher Columbus")  1.00/0.21/0.32  4.7s  1715 input tokens
tick 3  openLink("Paolo dal Pozzo Toscanelli")  1.00/0.13/0.18  8.3s  2977 input tokens
tick 4  openLink("Strabo")  1.00/0.13/0.78  2.6s  839 input tokens
tick 5  openLink("Roman Empire")  1.00/0.22/0.83  3.1s  1158 input tokens
tick 6  achieved  checked  0.9s
achieved  9578 input tokens in 10 requests
```

[`examples/wikirace.plain.ts`](examples/wikirace.plain.ts) is the same race as a plain one-off
script on TypeSafe's SDK (`@typesafe-ai/sdk`), making the same requests (the same picks,
probabilities and tokens on clef-flash) in 150 lines: bundles, splitting on refusal, the budget
and the log, written out. [`examples/wikirace.advocaat.ts`](examples/wikirace.advocaat.ts) does it
with [advocaat](https://github.com/pithings/advocaat)'s `ask` in 143: a client saves the HTTP code,
not the loop around it.

- `initGut(options?)` reads the config once ([Configuration](#configuration)) and returns
  `{ runTask }`, which runs tasks on it.
- `runTask(tick, options?)` calls `tick` at the start of every tick and resolves when the run ends,
  with its outcome, its steps, the last context and its `usage` (input tokens and requests).
  - `inputTokenBudget` (default 50,000) is how many input tokens the run may spend on the decision
    model. It is checked before each request, so a run overshoots by at most one request. Decision
    models charge only for input, and their time scales with it.
  - `isGoalAchieved` checks the goal in code, each tick after `tick` and before any request: true
    ends the run as `achieved`. Set it whenever the task can check its goal; the model is then
    never asked about the goal, so it can't stop a run on a near miss, and `goal` only gives it
    direction. Unset, the model judges the goal ([What the model receives](#what-the-model-receives)).
  - `plugins` (planned) add their own context and ops; see [Plugins](#plugins).
- `tick` returns this tick's `context` and `ops`.
  - `context` is `{ goal: string, ...rest }`, where everything in `rest` must be JSON. It is exactly
    what the model reads. A line saying what the user is doing and what a good pick is (the `instruction`
    above) is what gives the model direction; without it, picks drift. The wiki race keeps it to one
    line; a real task should say more: the rules, what a good move looks like, and preferences.
  - `ops` is a keyed record of moves; falsy entries (`false`, `null`, `undefined`) are skipped, so
    `key: cond && op(…)` is the conditional.
- `op(description, invoke)` or `op(description, { choices, strategy?, invoke })` is a move.
  - `choices` is a list of strings, or `{ label: value }` for values that aren't strings. The model
    picks one and `invoke` receives it. An empty list hides the op.
  - `strategy` is how choices that don't fit one question are asked: `ListStrategy.bundle` (the
    default; "Contains: …" bundles, then the choice inside one) or `ListStrategy.knockout` (pages of
    `maxOptions` choices, then the page winners).
- `group(description, ops)` groups ops, for example one group per form on a page.
- State is ordinary variables. Nothing is serialised.

## Plugins (planned)

A plugin brings its own context and ops, so a task only adds what is specific to it:

```ts
import { initGut, op } from '@gut.run/core';
import { browserPlugin } from '@gut.run/browser';

const trip = { departure: nextFriday() }; // ordinary state, which ops may change

const browser = browserPlugin(async () => ({
  initialUrl: 'https://www.google.com/travel/flights',
  typing: {
    text: {
      locations: { lhr: 'London', tyo: 'Tokyo' },
      departure: { humanReadable: format(trip.departure, 'd MMMM'), iso: toIsoDate(trip.departure) },
    },
    secrets: { google: { password: await keychain.get('google') } },
  },
}));

const { runTask } = await initGut();

await runTask(
  async () => ({
    context: { goal: 'The page shows flights from London to Tokyo next Friday, sorted by price' },
    ops: {
      home: op('Go back to the search page', () =>
        browser.goto('https://www.google.com/travel/flights'),
      ),
    },
  }),
  { plugins: [browser] },
);
```

```ts
type Plugin = {
  name: string; // its context key and its ops key
  setup?: () => Promise<void>; // before the first tick
  read: () => Promise<{ context: Json; ops: Ops }>; // every tick, before the task's tick
  teardown?: () => Promise<void>; // when the run ends, achieved or halted
};
```

- The browser plugin gives one group per on-screen element, holding only that element's real
  affordances: a text field offers typing, a button offers a click.
- A plugin package's factory takes its options as JSON, or as a function returning them that the
  plugin calls every tick, so values set by earlier ops are there to use. It validates them, so
  `--use-browser '{…}'` and `browserPlugin({…})` are the same call. `gut task` is that plugin with a
  task that only has a goal.
- Options read once say so in their name, as in `initialUrl`.
- A plugin's name sharing a context key or ops key with the task is an error on the first tick.

### acpx: supervising a coding agent

The acpx plugin drives a coding agent through [acpx](https://github.com/openclaw/acpx). The
decision model runs the loop and the agent does the reasoning, so no big model is paid to decide
"now run the tests".

```sh
gut task 'CI on PR #55 is green' --use-acpx '{
  "agent": "claude",
  "cwd": "~/code/my-app",
  "prompts": {
    "ci": { "read": "Read the failing CI logs and summarise the cause", "fix": "Fix that cause, then run pnpm test" },
    "git": { "push": "Commit and push the fix" },
    "nudge": { "continue": "Continue", "smaller": "That is too broad; make the smallest change that fixes it" }
  }
}'
```

Its context is the agent's `status` (idle, running, or waiting for permission), its trimmed
`lastReply`, and any `pendingPermission`. Its ops are offered only when they apply:

```
acpx.prompt(ci.fix)        the prompts tree, the same shape as the browser's typing.text
acpx.wait                  while the agent is running
acpx.cancel                while the agent is running
acpx.permission.approve    while a permission request is pending
acpx.permission.deny
```

Permission requests are settled by acpx's own policy (`approve-reads` by default). Only the tools
the options list are offered to the model to approve.

## Names

A step is named by its key path, which is how the log, the trace and the model's options refer to
it:

```
tick 3  browser.searchForm.to("Tokyo")         0.94   1.2s
tick 4  browser.searchForm.submit              0.97   0.8s
tick 5  browser.results.select("BA 7, £420")   0.71   1.9s
```

Keys are unique among siblings by construction. An op reused under different keys takes each key
path. Options are offered in the order the keys were written, except that integer-like keys come
first, as in any JS object. Levels the runtime adds to split a long list stay out of the name.

## What the model receives

```jsonc
{
  "state": {
    "instruction": "You are helping the user decide the next step for their wiki race by picking the most relevant link to click to reach their goal",
    "goal": "The current article is \"Roman Empire\"",
    "currentArticle": "Fruit"
  },
  "questions": {
    "achieved": {
      "type": "choice",
      "instructions": "Is the goal achieved?",
      "criteria": {
        "achieved": "Goal achieved: The current article is \"Roman Empire\"",
        "notYet": "Goal not achieved yet"
      }
    },
    "next": {
      "type": "choice",
      "instructions": "What should happen next?",
      "criteria": {
        "o1": "Open a link on the current article",
        "o2": "Go back to the starting article"
      }
    }
  }
}
```

`state` is the context, nothing added. A tick's first request asks two questions about it: whether
the goal is achieved, and the tick's first real choice (a level with one option has nothing to
ask). They are answered together and independently, so checking the goal costs no extra request
and sends the context once; only a tick with nothing to choose (one move, or none at all) asks the goal alone. When the goal is achieved the run ends and the move is
ignored. A task with `isGoalAchieved` (the wiki race) is never asked the `achieved` question;
its requests carry only the move. Later requests in the tick ask only the move, one level
further down, worded "Current action: Open a link on the current article. Which one?" (the
descriptions down to this level), since an option alone, such as a city, may not say what it is for.
Every request carries the whole state again: the API keeps nothing between requests. Measured on Jev over 15 articles (the start, a near miss and the target, for five
races), "Goal achieved" scored 0.99–1.00 at the target and at most 0.05 elsewhere.

## One tick

1. **Read.** Each plugin reads, then the task's `tick` runs.
2. **Check.** `isGoalAchieved`, if set, runs; true ends the run as `achieved`, with no request.
3. **Choose.** Without `isGoalAchieved`, the goal rides with the tick's first question, and a tick
   with nothing to choose (one move, or none at all) asks it alone. Each op's choices count as
   moves of their own. A question starts with every group closed and opens the smallest first, at
   any depth, while it stays within `maxOptions`: an open group's moves read with their path
   ("Header › Open link "Home""), a closed one with what it contains (an indented outline of its
   first 8 moves), and choosing a closed group asks inside it. Its first question ends with "None
   of these: go back" while a level above has anything else to choose (at `maxOptions` 2 it is an ordinary option, and may be bundled). A
   level with one option is skipped. A long list is split into bundles that each list everything they hold
   (each on its own line under "Contains:"); Clef wraps every option in about 18 tokens of framing, so 26 titles in one bundle
   cost far less than 26 options. A level the server refuses as too large (Ollama: over 64 KiB, or
   past the model's context) is split in half, each half picks its best, and the two winners are
   asked. Refused requests are not billed, so no size is estimated per model.
4. **Gate.** A goal answered as achieved ends the run as `achieved`, for the caller to check. The
   run halts with a reason when there are no options (once the goal is asked), anything throws (never retried), the run
   stalls (the same context and the same pick three times), or the input-token budget runs out.
   There is no confidence threshold: every pick runs, and its probabilities are logged.
5. **Invoke** the picked op with its choice.

## Trace

Each tick logs one line to stderr: the step, its probabilities, the time and the input tokens; the
run's last line is its outcome and total usage. A JSONL trace per tick (the context, the top options,
the pick and the timings) is planned, for debugging. A run that has ended is never continued, because the world it saw (a
browser page) has moved on; run again instead.

## Packages

| Package | What it is |
| --- | --- |
| `@gut.run/core` | `initGut`, `op`, `group`, the decision-model client |
| `@gut.run/browser`, `@gut.run/cua`, … | plugins (planned) |
| `@gut.run/cli` (bin `gut`) | `gut run task.gut.ts`; planned: `gut task '<goal>' --use-<plugin> …`, with every plugin bundled and heavy plugin dependencies (a browser) loaded on first use |

The API is plain TypeScript.

```sh
npm install @gut.run/core && npm install --global @gut.run/cli
```

## Configuration

A gut file says where its config comes from when it calls `initGut`:

- `await initGut()` reads `gut.config.json` in the working directory, else `~/gut.config.json`.
- `await initGut({ configJsonPath: '/path/to/gut.config.json' })` reads only that file; a relative
  path resolves from the working directory.
- `await initGut({ config: { decisionModel: … } })` takes it inline, checked like a file.

Files don't merge.

```json
{
  "decisionModel": {
    "endpoint": "http://localhost:11434/v1/systemone",
    "name": "clef-flash",
    "capabilities": { "image": false, "choiceQuestions": { "maxOptions": 26 } }
  }
}
```

`decisionModel` is everything about the model, in one place:

- `endpoint` is any `/v1/systemone` server: a local Ollama, or TypeSafe. It must report
  `usage.input_tokens`, which the token budget counts.
- `name` is the model the server runs: `clef-flash`, or `~typesafe/jev-latest` on OpenRouter.
- `apiKey`, optional, is sent as `Authorization: Bearer <apiKey>` (TypeSafe's API, OpenRouter).
- `capabilities`, optional, says what the model can take; every field has a default:
  - `choiceQuestions.maxOptions` is the most options one choice question takes: 255 by default, as
    TypeSafe's Jev takes. Ollama takes at most 26 and rejects more ("criteria must contain 2–26
    candidates"), so an Ollama config sets 26, as above. Every list strategy asks within it.
  - `image` is whether the state may hold images (default `false`). Nothing in gut sends one yet.

The file says where the model is and what it takes, nothing else; what a run may spend is the
task's option. Any other key, at any level, is an error.

With no file, `initGut()` fails before any task runs and says where to put one.

## Open questions

1. One `tick` returning `{ context, ops }`, or two functions, one for each?
2. The browser's other options: allowed origins (links elsewhere aren't offered), and attaching to
   an existing signed-in Chrome. Should it also offer values it finds on the page (autocomplete
   suggestions)?
3. Is a decision model a better picker than a small LLM? Unmeasured; the API doesn't depend on it.
4. Ops with side effects that can't be undone (paying, sending): does a run need permission to pick
   them?
5. Parked: tasks that collect, or find a minimum or maximum, as a fold over the stream of ticks
   (`for await (const tick of run)`, where `break` ends the run).
