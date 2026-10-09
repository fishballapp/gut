import { writeFileSync } from 'node:fs';
import { type Context, initGut, type TaskResult } from '@gut.run/core';
import { type Control, observe } from '@gut.run/playwright';
import { chromium } from 'playwright';
import { createFixtureServer, type FixtureServer } from '../browser-fixtures/index.ts';
import type { RunRecord } from './table.ts';
import { allTasks, observeValues } from './tasks.ts';
import { recordTrace } from './trace.ts';

const isNodeOp = (val: unknown): val is { kind: 'node'; ops: Record<string, unknown> } =>
  typeof val === 'object' &&
  val !== null &&
  'kind' in val &&
  val.kind === 'node' &&
  'ops' in val &&
  typeof val.ops === 'object' &&
  val.ops !== null;

const isLeafOp = (val: unknown): val is { kind: 'leaf' } =>
  typeof val === 'object' && val !== null && 'kind' in val && val.kind === 'leaf';

const countLeaves = (ops: Record<string, unknown>): number =>
  Object.values(ops).reduce<number>((count, entry) => {
    if (isLeafOp(entry)) return count + 1;
    if (isNodeOp(entry)) return count + countLeaves(entry.ops);
    return count;
  }, 0);

const parseArg = (flag: string): string | undefined => {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
};

const taskName = parseArg('--task');
if (taskName === undefined) {
  process.stderr.write('Error: --task is required\n');
  process.exit(1);
}

const rawMaxOptions = Number(parseArg('--maxOptions') ?? '26');
if (!Number.isInteger(rawMaxOptions) || rawMaxOptions <= 0) {
  process.stderr.write(`Error: Invalid --maxOptions "${parseArg('--maxOptions')}"\n`);
  process.exit(1);
}
const maxOptions = rawMaxOptions;

const rawRep = Number(parseArg('--rep') ?? '1');
if (!Number.isInteger(rawRep) || rawRep <= 0) {
  process.stderr.write(`Error: Invalid --rep "${parseArg('--rep')}"\n`);
  process.exit(1);
}
const rep = rawRep;

const taskDef = allTasks.find(t => t.name === taskName);
if (taskDef === undefined) {
  process.stderr.write(`Error: Task "${taskName}" not found\n`);
  process.exit(1);
}

// The bench writes each run's config, its maxOptions the variant's; alone, the usual lookup.
const configJsonPath = parseArg('--config');
const { runTask } = await initGut(configJsonPath === undefined ? undefined : { configJsonPath });

const tracePath = parseArg('--trace');
const trace = tracePath === undefined ? undefined : recordTrace();

const startTime = performance.now();

/** Writes the run's trace, when asked for one, beside the result it explains. */
const writeTrace = (record: RunRecord) => {
  if (tracePath === undefined || trace === undefined) return;
  const outcome = record.success ? 'success' : `failed: ${record.status} ${record.reason ?? ''}`;
  writeFileSync(
    tracePath,
    trace.render(`${record.task} ${record.variant} rep ${record.rep}: ${outcome}`),
  );
  // The same events as data, for tools that draw them.
  writeFileSync(
    tracePath.replace(/\.md$/, '.json'),
    JSON.stringify({ record, events: trace.events() }, null, 2),
  );
};

const variantName = String(maxOptions);

/** Why a run halted: its error's message, or the reason gut gave. */
const reasonOf = (result: TaskResult): string | undefined => {
  if (result.status !== 'halted') return undefined;
  return result.reason === 'error' ? result.error : result.reason;
};

/** Reports the run: its trace beside it, and one result line for the bench to read. */
const emit = (record: RunRecord) => {
  writeTrace(record);
  process.stdout.write(`\n===BENCH_RESULT===\n${JSON.stringify(record)}\n`);
};

const run = async (): Promise<void> => {
  let server: FixtureServer | undefined;
  let firstTickOpsSize: { topLevel: number; leaves: number } | undefined;

  try {
    const target = await (async () => {
      if (taskDef.fixture !== undefined) {
        const fixtureServer = await createFixtureServer();
        server = fixtureServer;
        return {
          startUrl: `${fixtureServer.origin}/${taskDef.fixture.job}/${taskDef.fixture.layout}`,
          origin: fixtureServer.origin,
        };
      }
      if (taskDef.startUrl !== undefined) {
        return {
          startUrl: taskDef.startUrl,
          origin: new URL(taskDef.startUrl).origin,
        };
      }
      throw new Error(`Task "${taskName}" has neither fixture nor startUrl`);
    })();

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // The run, then its own check of the goal; the browser closes whatever happens, and a failure
    // before the run ends is reported once, below.
    const outcome = await (async () => {
      try {
        await page.goto(target.startUrl);
        // The grader's target, read before any move; without it no run could pass, so it's infra.
        const grading = await (async () => {
          try {
            const expected =
              taskDef.expected === undefined ? undefined : await taskDef.expected(page);
            return { expected };
          } catch (error) {
            return { failure: error instanceof Error ? error.message : String(error) };
          }
        })();
        if ('failure' in grading) return { kind: 'infra' as const, reason: grading.failure };
        const { expected } = grading;
        // As browser.gut.ts: links stay on the site the task started on.
        const site = new URL(page.url()).host;
        const isOnSite = (control: Control) => {
          if (control.url === undefined) return true; // not a link
          return URL.canParse(control.url) && new URL(control.url).host === site;
        };

        const result = await runTask(
          async () => {
            const { context: pageContext, ops } = await observe(page, {
              values: observeValues(taskDef),
              shouldOffer: isOnSite,
            });
            if (firstTickOpsSize === undefined) {
              firstTickOpsSize = { topLevel: Object.keys(ops).length, leaves: countLeaves(ops) };
            }
            const context: Context = {
              instruction: taskDef.instruction,
              goal: taskDef.goal,
              page: pageContext,
            };
            return { context, ops };
          },
          {
            inputTokenBudget: taskDef.fixture !== undefined ? 60_000 : 150_000,
          },
        );
        // Success is the task's own check after the run: the model's "achieved" does not count.
        const success = await taskDef.isDone(page, server, expected).catch(() => false);
        return { kind: 'completed' as const, result, success };
      } finally {
        await page.close();
        await browser.close();
      }
    })();

    if (outcome.kind === 'infra') {
      emit({
        task: taskDef.name,
        variant: variantName,
        rep,
        success: false,
        status: 'infra',
        reason: outcome.reason,
        steps: { count: 0, names: [] },
        usage: { requests: 0, inputTokens: 0 },
        wallClockMs: Math.round(performance.now() - startTime),
        firstTickOpsSize: { topLevel: 0, leaves: 0 },
      });
      return;
    }

    emit({
      task: taskDef.name,
      variant: variantName,
      rep,
      success: outcome.success,
      status: outcome.result.status,
      reason: reasonOf(outcome.result),
      steps: { count: outcome.result.steps.length, names: outcome.result.steps },
      claimedDone: outcome.result.status === 'achieved',
      usage: outcome.result.usage,
      wallClockMs: Math.round(performance.now() - startTime),
      firstTickOpsSize: firstTickOpsSize ?? { topLevel: 0, leaves: 0 },
    });
  } catch (error) {
    const wallClockMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    emit({
      task: taskDef.name,
      variant: variantName,
      rep,
      success: false,
      status: 'error',
      reason: message,
      steps: { count: 0, names: [] },
      usage: { requests: 0, inputTokens: 0 },
      wallClockMs,
      firstTickOpsSize: firstTickOpsSize ?? { topLevel: 0, leaves: 0 },
    });
  } finally {
    if (server !== undefined) {
      await server.close();
    }
  }
};

await run();
