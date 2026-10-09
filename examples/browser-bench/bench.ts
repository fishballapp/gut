import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOp, type Ops } from '@gut.run/core';
import { observe } from '@gut.run/playwright';
import { chromium } from 'playwright';
import { readConfigFile } from './schema.ts';
import {
  aggregateBenchmarkResults,
  formatMarkdownTable,
  type RunRecord,
  RunRecordSchema,
} from './table.ts';
import { allTasks, type BenchmarkTask, fixtureTasks, liveTasks } from './tasks.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const parseFlag = (flag: string): string | undefined => {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
};

// --- Dump Mode Helpers ---

const formatOpTree = (ops: Ops, indent = 0): string => {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(ops)) {
    if (!isOp(entry)) continue;
    if (entry.kind === 'leaf') {
      lines.push(`${pad}- [${key}] ${entry.description}`);
    } else if (entry.kind === 'node') {
      lines.push(`${pad}+ [${key}] ${entry.description}`);
      lines.push(formatOpTree(entry.ops, indent + 1));
    }
  }
  return lines.join('\n');
};

const runDump = async (url: string): Promise<string> => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const { ops } = await observe(page);
    // The tree as observe builds it; how much of it a question opens is core's, by maxOptions.
    const sections = [`BROWSER OPS DUMP: ${url}`, '', formatOpTree(ops), ''];

    return sections.join('\n');
  } finally {
    await page.close();
    await browser.close();
  }
};

// --- Benchmark Runner Helpers ---

type VariantSpec = {
  readonly raw: string;
  readonly maxOptions: number;
  readonly isUltrafast?: boolean;
};

const parseVariant = (raw: string): VariantSpec => {
  if (raw === 'ultrafast') {
    return { raw: 'ultrafast', maxOptions: 255, isUltrafast: true };
  }
  const maxOptions = Number(raw);
  if (!Number.isInteger(maxOptions) || maxOptions < 2) {
    throw new Error(`--variants takes maxOptions (e.g. 255,26) or ultrafast, got "${raw}"`);
  }
  return { raw, maxOptions };
};

const runOneChild = async (
  runOnePath: string,
  tempDir: string,
  taskName: string,
  variant: VariantSpec,
  rep: number,
  timeoutMs: number,
  tracePath: string,
): Promise<RunRecord> => {
  return new Promise<RunRecord>(resolvePromise => {
    let stdout = '';
    let stderr = '';
    let isSettled = false;

    const child = spawn(
      process.execPath,
      [
        runOnePath,
        '--task',
        taskName,
        '--maxOptions',
        String(variant.maxOptions),
        '--rep',
        String(rep),
        '--trace',
        tracePath,
        '--config',
        join(tempDir, 'gut.config.json'),
      ],
      {
        cwd: tempDir,
        env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '' },
      },
    );

    const timer = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 30_000);
      child.once('close', () => clearTimeout(killTimer));
      // ponytail: the bench is dev-only, and a rare overlap costs at most an infra-counted run; await child exit if overlapping runs show up.
      resolvePromise({
        task: taskName,
        variant: variant.raw,
        rep,
        success: false,
        status: 'timeout',
        reason: '3-minute hard wall timeout exceeded',
        steps: { count: 0, names: [] },
        wallClockMs: timeoutMs,
        firstTickOpsSize: { topLevel: 0, leaves: 0 },
      });
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });

    child.on('close', code => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);

      try {
        const marker = '===BENCH_RESULT===';
        const markerIdx = stdout.indexOf(marker);
        if (markerIdx !== -1) {
          const jsonStr = stdout.slice(markerIdx + marker.length).trim();
          const parsed = JSON.parse(jsonStr);
          const validated = RunRecordSchema.safeParse(parsed);
          if (validated.success) {
            resolvePromise(validated.data);
            return;
          }
        }
      } catch {
        // Fall through to error record
      }

      resolvePromise({
        task: taskName,
        variant: variant.raw,
        rep,
        success: false,
        status: 'error',
        reason: stderr.trim() || `Child process exited with code ${code}`,
        steps: { count: 0, names: [] },
        usage: { requests: 0, inputTokens: 0 },
        wallClockMs: 0,
        firstTickOpsSize: { topLevel: 0, leaves: 0 },
      });
    });
  });
};

const runUltrafastChild = async (
  ultrafastPath: string,
  taskName: string,
  rep: number,
  timeoutMs: number,
  tracePath: string,
  ultrafastDir: string,
  configPath?: string,
): Promise<RunRecord> => {
  return new Promise<RunRecord>(resolvePromise => {
    let stdout = '';
    let stderr = '';
    let isSettled = false;

    const child = spawn(
      process.execPath,
      [
        ultrafastPath,
        '--task',
        taskName,
        '--rep',
        String(rep),
        '--trace',
        tracePath,
        '--ultrafast-dir',
        ultrafastDir,
        ...(configPath !== undefined ? ['--config', configPath] : []),
      ],
      {
        env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '' },
      },
    );

    const timer = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 30_000);
      child.once('close', () => clearTimeout(killTimer));
      resolvePromise({
        task: taskName,
        variant: 'ultrafast',
        rep,
        success: false,
        status: 'timeout',
        reason: '3-minute hard wall timeout exceeded',
        steps: { count: 0, names: [] },
        wallClockMs: timeoutMs,
        firstTickOpsSize: { topLevel: 0, leaves: 0 },
      });
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });

    child.on('close', code => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);

      try {
        const marker = '===BENCH_RESULT===';
        const markerIdx = stdout.indexOf(marker);
        if (markerIdx !== -1) {
          const jsonStr = stdout.slice(markerIdx + marker.length).trim();
          const parsed = JSON.parse(jsonStr);
          const validated = RunRecordSchema.safeParse(parsed);
          if (validated.success) {
            resolvePromise(validated.data);
            return;
          }
        }
      } catch {
        // Fall through
      }

      const isInfra =
        stderr.includes('_IPCResponseTimeout') || stdout.includes('_IPCResponseTimeout');
      resolvePromise({
        task: taskName,
        variant: 'ultrafast',
        rep,
        success: false,
        status: isInfra ? 'infra' : 'error',
        reason: isInfra
          ? 'harness timeout (_IPCResponseTimeout)'
          : stderr.trim() || `Child process exited with code ${code}`,
        steps: { count: 0, names: [] },
        usage: { requests: 0, inputTokens: 0 },
        wallClockMs: 0,
        firstTickOpsSize: { topLevel: 0, leaves: 0 },
      });
    });
  });
};

type BenchmarkJob = {
  readonly rep: number;
  readonly taskDef: BenchmarkTask;
  readonly variant: VariantSpec;
};

// --- Main ---

const main = async (): Promise<void> => {
  const dumpUrl = parseFlag('--dump');
  if (dumpUrl !== undefined) {
    const dumpOutput = await runDump(dumpUrl);
    process.stdout.write(dumpOutput);
    return;
  }

  const tasksArg = parseFlag('--tasks');
  const tasksToRun = (() => {
    if (tasksArg === undefined || tasksArg === 'fixtures') return fixtureTasks;
    if (tasksArg === 'live') return liveTasks;
    const selectedTaskNames = tasksArg.split(',');
    return selectedTaskNames
      .map(name => allTasks.find(t => t.name === name))
      .filter((t): t is (typeof allTasks)[number] => t !== undefined);
  })();

  const variantsArg = parseFlag('--variants') ?? '255,26';
  const variants = variantsArg.split(',').map(parseVariant);

  const hasUltrafast = variants.some(v => v.isUltrafast);
  const ultrafastDirArg = parseFlag('--ultrafast-dir');
  if (hasUltrafast && ultrafastDirArg === undefined) {
    process.stderr.write(
      'Error: --ultrafast-dir is required when running the "ultrafast" variant\n',
    );
    process.exit(1);
  }
  const ultrafastDir = ultrafastDirArg !== undefined ? resolve(ultrafastDirArg) : undefined;

  const repsArg = Number(parseFlag('--reps') ?? '3');

  // --config picks a decision model other than the usual gut.config.json, e.g. Jev beside a local Clef.
  const configPath = parseFlag('--config');
  const baseConfig = readConfigFile(configPath);

  const benchDir = resolve(__dirname, '../../../../tmp/gut-bench');
  mkdirSync(benchDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsJsonPath = join(benchDir, `${timestamp}.json`);
  // One readable trace per run, every request and tick in order: tmp/gut-bench/<timestamp>/.
  const tracesDir = join(benchDir, timestamp);
  mkdirSync(tracesDir, { recursive: true });

  const runOnePath = join(__dirname, 'run-one.ts');
  const ultrafastPath = join(__dirname, 'ultrafast.ts');
  const timeoutMs = 180_000; // 3 minutes

  // Runs share nothing but the decision model, so a remote one (Jev) takes several at once; a local
  // one (Ollama) is best left at 1.
  const concurrency = Number(parseFlag('--concurrency') ?? '1');
  const jobs: readonly BenchmarkJob[] = Array.from({ length: repsArg }, (_, i) => i + 1).flatMap(
    rep => tasksToRun.flatMap(taskDef => variants.map(variant => ({ rep, taskDef, variant }))),
  );
  const allRecords: RunRecord[] = [];

  const handleRecordFinished = (
    record: RunRecord,
    taskDef: BenchmarkTask,
    variant: VariantSpec,
    rep: number,
  ) => {
    allRecords.push(record);
    writeFileSync(resultsJsonPath, JSON.stringify(allRecords, null, 2), 'utf8');
    const statusMsg = record.success ? 'SUCCESS' : `FAILED (${record.status})`;
    process.stderr.write(
      `[${allRecords.length}/${jobs.length}] ${taskDef.name} ${variant.raw} (rep ${rep}): ${statusMsg} in ${(record.wallClockMs / 1000).toFixed(1)}s, ${record.usage !== undefined ? `${record.usage.requests} reqs` : 'timeout'}\n`,
    );
  };

  // Active temporary directories holding gut.config.json with API keys, tracked so
  // they are guaranteed to be removed on every path including SIGTERM and SIGINT.
  const activeTempDirs = new Set<string>();

  const cleanupAllTempDirs = () => {
    for (const dir of activeTempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best effort removal on exit
      }
    }
    activeTempDirs.clear();
  };

  // ponytail: the bench is dev-only, and a rare overlap costs at most an infra-counted run; await child exit if overlapping runs show up.
  process.on('SIGTERM', () => {
    cleanupAllTempDirs();
    process.exit(143);
  });

  process.on('SIGINT', () => {
    cleanupAllTempDirs();
    process.exit(130);
  });

  const runGutJob = async ({ rep, taskDef, variant }: BenchmarkJob): Promise<void> => {
    const tempDir = mkdtempSync(join(tmpdir(), 'gut-bench-cfg-'));
    activeTempDirs.add(tempDir);
    const runConfig = {
      decisionModel: {
        ...baseConfig.decisionModel,
        capabilities: {
          ...baseConfig.decisionModel.capabilities,
          choiceQuestions: { maxOptions: variant.maxOptions },
        },
      },
    };
    writeFileSync(join(tempDir, 'gut.config.json'), JSON.stringify(runConfig, null, 2), 'utf8');
    const record = await runOneChild(
      runOnePath,
      tempDir,
      taskDef.name,
      variant,
      rep,
      timeoutMs,
      join(tracesDir, `${taskDef.name}.${variant.raw.replaceAll(':', '-')}.${rep}.md`),
    ).finally(() => {
      activeTempDirs.delete(tempDir);
      rmSync(tempDir, { recursive: true, force: true });
    });
    handleRecordFinished(record, taskDef, variant, rep);
  };

  const runUltrafastJob = async ({ rep, taskDef, variant }: BenchmarkJob): Promise<void> => {
    if (ultrafastDir === undefined) {
      throw new Error('ultrafastDir is undefined');
    }
    const record = await runUltrafastChild(
      ultrafastPath,
      taskDef.name,
      rep,
      timeoutMs,
      join(tracesDir, `${taskDef.name}.${variant.raw.replaceAll(':', '-')}.${rep}.md`),
      ultrafastDir,
      configPath,
    );
    handleRecordFinished(record, taskDef, variant, rep);
  };

  const gutJobs = jobs.filter(j => !j.variant.isUltrafast);
  const ultrafastJobs = jobs.filter(j => j.variant.isUltrafast);

  const gutQueue = [...gutJobs];
  const runGutLane = async (): Promise<void> => {
    const job = gutQueue.shift();
    if (job === undefined) return;
    await runGutJob(job);
    await runGutLane();
  };
  const gutPromise = Promise.all(Array.from({ length: concurrency }, runGutLane));

  const ultrafastQueue = [...ultrafastJobs];
  const runUltrafastLane = async (): Promise<void> => {
    const job = ultrafastQueue.shift();
    if (job === undefined) return;
    await runUltrafastJob(job);
    await runUltrafastLane();
  };
  const ultrafastPromise = runUltrafastLane();

  await Promise.all([gutPromise, ultrafastPromise]);

  const aggregation = aggregateBenchmarkResults(allRecords);
  const tableMarkdown = formatMarkdownTable(aggregation);

  process.stdout.write(`\n${tableMarkdown}\n`);
  process.stderr.write(`\nResults saved to ${resultsJsonPath}\n`);
};

await main();
