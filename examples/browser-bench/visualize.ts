// Draws a bench run's traces as one HTML page: per run, each tick's requests in order, indented by
// how deep the pick has drilled, with every option's probability as a bar.
// node projects/gut/examples/browser-bench/visualize.ts tmp/gut-bench/<timestamp> [--compact] [--runs a,b]
// --compact keeps each question's likeliest options only, for a page small enough to embed; --runs
// keeps the runs whose file names start with one of the given prefixes, in that order.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  describeCriterion,
  type RequestEvent,
  ResponseSchema,
  type TraceFile,
  TraceFileSchema,
} from './schema.ts';

export type Trace = TraceFile;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A long option list shows its likeliest options and the chosen one; the rest fold away. */
const isCompact = process.argv.includes('--compact');
const SHOWN_OPTIONS = isCompact ? 8 : 12;
const FOLDED_OPTIONS = isCompact ? 0 : 20;
/** Compact descriptions are cut, so a group's long preview doesn't fill the page. */
const shorten = (text: string) =>
  isCompact && text.length > 110 ? `${text.slice(0, 109)}…` : text;

const pageOf = (state: Record<string, unknown>) => {
  const page = z.object({ url: z.string(), title: z.string() }).safeParse(state.page);
  return page.success ? page.data : { url: '', title: '' };
};

/** How deep the pick is: the top asks "What should happen next?", a level names its trail. */
const depthOf = (instructions: unknown) =>
  typeof instructions === 'string' && instructions.startsWith('Current action: ')
    ? instructions.slice('Current action: '.length).split(' › ').length
    : 0;

const kindOf = (description: string) => {
  if (description === 'None of these: go back') return 'back';
  if (description.includes(' — contains: ') || description.startsWith('Contains: ')) return 'group';
  return 'step';
};

const renderOptions = (
  criteria: Record<string, unknown>,
  answer: { choice: string; probabilities: Record<string, number> } | undefined,
) => {
  const options = Object.entries(criteria).map(([key, crit], index) => {
    const description = describeCriterion(crit);
    return {
      key,
      index,
      description,
      probability: answer?.probabilities[key] ?? 0,
      isChosen: answer?.choice === key,
    };
  });
  const ranked = [...options].sort((a, b) => b.probability - a.probability);
  const shownKeys = new Set(ranked.slice(0, SHOWN_OPTIONS).map(option => option.key));
  const row = (option: (typeof options)[number]) => `
      <div class="option ${kindOf(option.description)} ${option.isChosen ? 'chosen' : ''}">
        <span class="num">${option.index + 1}</span>
        <span class="bar"><span style="width:${(option.probability * 100).toFixed(1)}%"></span></span>
        <span class="p">${option.probability.toFixed(2)}</span>
        <span class="desc" title="${escapeHtml(shorten(option.description))}">${escapeHtml(shorten(option.description))}</span>
      </div>`;
  const shown = options.filter(option => shownKeys.has(option.key) || option.isChosen);
  // The folded rest keeps page order, capped so a 255-option question stays a readable page.
  const hidden = options.filter(option => !shown.includes(option));
  const folded = hidden.slice(0, FOLDED_OPTIONS);
  const unlisted = hidden.length - folded.length;
  return [
    ...shown.map(row),
    hidden.length === 0
      ? ''
      : `<details class="more"><summary>${hidden.length} more options, all less likely</summary>${folded.map(row).join('')}${unlisted === 0 ? '' : `<div class="unlisted">… ${unlisted} more not listed</div>`}</details>`,
  ].join('');
};

/** Where a question stands, as breadcrumbs of box labels (their previews left out). */
const trailOf = (instructions: unknown, depth: number) => {
  if (typeof instructions !== 'string' || depth === 0) return 'Top level';
  return instructions
    .slice('Current action: '.length)
    .replace(/\. Which one\?$/, '')
    .split(' › ')
    .map(part => `<span class="crumb">${escapeHtml(part.split(' — contains: ')[0] ?? part)}</span>`)
    .join('<span class="sep">›</span>');
};

const renderRequest = (event: RequestEvent, n: number) => {
  const { questions } = event.request;
  const { response } = event;
  const parsedResponse = ResponseSchema.safeParse(response);
  const answers = parsedResponse.success ? parsedResponse.data.answers : {};
  const refusalParsed = z.object({ status: z.number(), text: z.string() }).safeParse(response);
  const refusal = refusalParsed.success ? refusalParsed.data : undefined;
  const next = questions.next ?? questions.operation;
  const goal = answers.achieved;
  const depth = next === undefined ? 0 : depthOf(next.instructions);
  const trail = next === undefined ? 'Goal only' : trailOf(next.instructions, depth);
  const tokens = parsedResponse.success ? parsedResponse.data.usage?.input_tokens : undefined;

  const nonAchievedQuestions = Object.entries(questions).filter(([key]) => key !== 'achieved');
  const isMulti = nonAchievedQuestions.length > 1;

  const questionsHtml = nonAchievedQuestions
    .map(([key, question]) => {
      const qAnswer = answers[key];
      const count = Object.keys(question.criteria).length;
      const head = isMulti
        ? `<div class="q-head"><span class="q-key">${escapeHtml(key)}</span><span class="count">${count} options</span></div>`
        : '';
      return `<div class="q-block">${head}${renderOptions(question.criteria, qAnswer)}</div>`;
    })
    .join('');

  return `
    <div class="request" style="margin-left:${depth * 28}px">
      <div class="req-head">
        <span class="req-n">Request ${n}</span>
        <span class="trail">${trail}</span>
        ${goal === undefined ? '' : `<span class="goal ${goal.choice}">goal: ${goal.choice} ${(goal.probabilities[goal.choice] ?? 0).toFixed(2)}</span>`}
        ${!isMulti && next !== undefined ? `<span class="count">${Object.keys(next.criteria).length} options</span>` : ''}
        ${tokens === undefined ? '' : `<span class="tokens">${tokens.toLocaleString()} tokens</span>`}
        ${refusal === undefined ? '' : `<span class="goal">refused ${refusal.status}: ${escapeHtml(refusal.text.slice(0, 120))}</span>`}
      </div>
      ${questionsHtml}
    </div>`;
};

const renderRun = (trace: Trace, id: string) => {
  // Requests belong to the tick whose log line follows them.
  const ticks = trace.events.reduce<{
    done: { requests: RequestEvent[]; line: string }[];
    open: RequestEvent[];
  }>(
    (acc, event) => {
      if (event.kind === 'request') return { ...acc, open: [...acc.open, event] };
      if (!/^tick \d+/.test(event.line)) return acc;
      return { done: [...acc.done, { requests: acc.open, line: event.line }], open: [] };
    },
    { done: [], open: [] },
  );
  const allTicks = [
    ...ticks.done,
    ...(ticks.open.length > 0 ? [{ requests: ticks.open, line: '(run ended)' }] : []),
  ];
  const ending = trace.events.findLast(event => event.kind === 'log')?.line ?? '';
  const counter = { n: 0 };
  const body = allTicks
    .map(({ requests, line }, i) => {
      const first = requests[0];
      const page = first === undefined ? { url: '', title: '' } : pageOf(first.request.state);
      const [, step = ''] = line.match(/^tick \d+\s+(\S+)/) ?? [];
      return `
      <section class="tick">
        <div class="tick-head">
          <span class="tick-n">Tick ${i + 1}</span>
          <span class="page" title="${escapeHtml(page.url)}">${escapeHtml(page.title || page.url)}</span>
          <span class="url">${escapeHtml(page.url)}</span>
        </div>
        ${requests
          .map(request => {
            counter.n += 1;
            return renderRequest(request, counter.n);
          })
          .join('')}
        <div class="ran">${step === '' ? escapeHtml(line) : `ran <code>${escapeHtml(step)}</code>`}</div>
      </section>`;
    })
    .join('');
  const { record } = trace;
  const requestsCount = record.usage?.requests ?? 0;
  const inputTokensCount = record.usage?.inputTokens ?? 0;
  const wallClockMs = record.wallClockMs ?? 0;
  return `
    <article id="${id}" class="run">
      <h2>${escapeHtml(record.task)} <span class="variant">${escapeHtml(record.variant)}</span>
        <span class="badge ${record.success ? 'ok' : 'fail'}">${record.success ? 'goal reached' : `failed: ${escapeHtml(record.reason ?? record.status ?? 'failed')}`}</span></h2>
      <p class="summary">${requestsCount} requests · ${inputTokensCount.toLocaleString()} input tokens · ${(wallClockMs / 1000).toFixed(1)} s · ${escapeHtml(ending)}</p>
      ${body}
    </article>`;
};

/** The page for a set of runs' traces, one tab per run. */
export const renderPage = (traces: readonly { id: string; trace: Trace }[]): string => {
  const tabs = traces
    .map(
      ({ id, trace: { record } }) =>
        `<button data-run="${id}"><span class="dot ${record.success ? 'ok' : 'fail'}"></span>${escapeHtml(record.task)} <span class="variant">${escapeHtml(record.variant)}</span></button>`,
    )
    .join('');

  // Theme variables fall back to a dark palette, so the page reads the same in a browser and embedded.
  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"><title>gut browser bench: turn by turn</title>
  <style>
    :root { --text:var(--foreground,#e6e8ee); --dim:var(--muted-foreground,#8a91a3); --line:var(--border,#2a2f3a); --panel:var(--card,#171a21); --chip:color-mix(in srgb, var(--text) 9%, transparent); --accent:#7aa2ff; --ok:#3ecf8e; --fail:#ff6b6b; --group:#c792ea; --back:#ffb454; --move:color-mix(in srgb, var(--text) 35%, transparent); }
    * { box-sizing:border-box; }
    body { margin:0; font:13px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif; color:var(--text); }
    .tabs { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
    .tabs button { font:inherit; font-size:12px; color:var(--text); background:var(--chip); border:1px solid transparent; border-radius:99px; padding:4px 10px; cursor:pointer; display:flex; align-items:center; gap:6px; }
    .tabs button.active { border-color:var(--accent); }
    .dot { width:7px; height:7px; border-radius:50%; flex:none; } .dot.ok { background:var(--ok); } .dot.fail { background:var(--fail); }
    .legend { display:flex; gap:14px; color:var(--dim); font-size:12px; margin-bottom:10px; flex-wrap:wrap; }
    .legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:-1px; }
    .run { display:none; } .run.active { display:block; }
    h2 { font-size:16px; margin:4px 0 2px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .variant { color:var(--accent); font-weight:500; font-family:ui-monospace,monospace; font-size:.9em; }
    .badge { font-size:11px; padding:2px 8px; border-radius:99px; font-weight:600; } .badge.ok { background:color-mix(in srgb, var(--ok) 18%, transparent); color:var(--ok); } .badge.fail { background:color-mix(in srgb, var(--fail) 18%, transparent); color:var(--fail); }
    .summary { color:var(--dim); margin:0 0 12px; }
    .tick { border:1px solid var(--line); border-radius:10px; background:var(--panel); margin:0 0 12px; padding:12px 14px; }
    .tick-head { display:flex; align-items:baseline; gap:10px; margin-bottom:6px; flex-wrap:wrap; }
    .tick-n { font-weight:700; } .page { font-weight:500; } .url { color:var(--dim); font-family:ui-monospace,monospace; font-size:11px; word-break:break-all; }
    .request { border-left:2px solid var(--line); padding:6px 0 8px 10px; margin-top:6px; }
    .req-head { display:flex; align-items:center; gap:6px; margin-bottom:5px; flex-wrap:wrap; }
    .req-n { font-weight:600; color:var(--dim); font-size:12px; }
    .trail { font-size:12px; } .crumb { background:var(--chip); padding:1px 6px; border-radius:4px; } .sep { color:var(--dim); margin:0 3px; }
    .goal, .count, .tokens { font-size:11px; color:var(--dim); border:1px solid var(--line); padding:0 6px; border-radius:4px; }
    .goal.achieved { color:var(--ok); border-color:var(--ok); }
    .q-block { margin-top:4px; }
    .q-head { display:flex; align-items:center; gap:6px; margin:4px 0 2px; }
    .q-key { font-size:11px; font-weight:600; color:var(--dim); font-family:ui-monospace,monospace; }
    .option { display:grid; grid-template-columns:24px 90px 34px minmax(0,1fr); align-items:center; gap:7px; padding:2px 6px; border-radius:5px; }
    .option .num { color:var(--dim); font-size:11px; text-align:right; }
    .bar { height:8px; background:var(--chip); border-radius:4px; overflow:hidden; } .bar span { display:block; height:100%; background:var(--move); }
    .p { font-family:ui-monospace,monospace; font-size:11px; color:var(--dim); }
    .desc { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .option.group .desc { color:var(--group); } .option.group .bar span { background:var(--group); }
    .option.back .desc { color:var(--back); font-style:italic; } .option.back .bar span { background:var(--back); }
    .option.chosen { background:color-mix(in srgb, var(--accent) 16%, transparent); outline:1px solid var(--accent); } .option.chosen .bar span { background:var(--accent); } .option.chosen .p { color:var(--text); font-weight:700; }
    .more summary { color:var(--dim); cursor:pointer; font-size:12px; padding:3px 6px; }
    .unlisted { color:var(--dim); font-size:12px; padding:2px 6px 2px 36px; }
    .ran { margin-top:8px; padding-top:8px; border-top:1px dashed var(--line); color:var(--dim); word-break:break-all; }
    .ran code { color:var(--ok); font-size:12px; }
  </style></head>
  <body>
    <div class="tabs">${tabs}</div>
    <div class="legend"><span><i style="background:var(--accent)"></i>chosen</span><span><i style="background:var(--group)"></i>a box (group)</span><span><i style="background:var(--back)"></i>go back</span><span><i style="background:var(--move)"></i>a move</span><span>Indent = how deep the pick has drilled.</span></div>
    ${traces.map(({ id, trace }) => renderRun(trace, id)).join('')}
  <script>
    const show = id => {
      document.querySelectorAll('.run').forEach(run => run.classList.toggle('active', run.id === id));
      document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.run === id));
    };
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.run)));
    show(document.querySelector('.run')?.id);
  </script>
  </body></html>`;
};

/** A run's trace JSON, as run-one.ts writes it. */
export const parseTrace = (json: unknown): Trace => TraceFileSchema.parse(json);

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const dir = process.argv[2];
  const runsFlag = process.argv.indexOf('--runs');
  const runPrefixes = runsFlag === -1 ? undefined : process.argv[runsFlag + 1]?.split(',');
  if (dir === undefined) throw new Error('Usage: visualize.ts <bench traces directory>');

  const files = readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .sort();
  const traces = (
    runPrefixes === undefined
      ? files
      : runPrefixes.flatMap(prefix => files.filter(file => file.startsWith(prefix)))
  ).map(file => ({
    id: file.replace(/\.json$/, '').replace(/[^a-z0-9]+/gi, '-'),
    trace: parseTrace(JSON.parse(readFileSync(join(dir, file), 'utf8'))),
  }));

  const out = join(dir, 'index.html');
  writeFileSync(out, renderPage(traces));
  process.stdout.write(`${out}\n`);
}
