import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { z } from 'zod';
import { createFixtureServer, type FixtureServer } from '../browser-fixtures/index.ts';
import { readConfigFile } from './schema.ts';
import type { RunRecord } from './table.ts';
import { allTasks, type BenchmarkTask, hideSecrets } from './tasks.ts';
import { EventSchema, recordTrace } from './trace.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const parseArg = (flag: string): string | undefined => {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
};

// jev-ultrafast has no secrets mechanism, so its goal carries the secrets in clear text beside the
// values; what the run saves and prints has them hidden (`hideSecrets`).
const buildGoalText = (task: BenchmarkTask): string => {
  const values = Object.entries({ ...task.values, ...task.secrets }).map(
    ([what, value]) => `${what}: ${value}`,
  );
  const instruction = task.instruction.replace(/^You are helping the user /, 'Help the user ');
  const valuesSuffix = values.length > 0 ? ` Values to use: ${values.join('; ')}.` : '';
  return `${instruction}. Done when: ${task.goal}.${valuesSuffix}`;
};

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export const DriverResultSchema = z.object({
  status: z.string().optional(),
  error: z.string().nullable().optional(),
  rounds: z.number().optional(),
  actions: z.array(z.unknown()).optional(),
  requests: z.number().optional(),
  inputTokens: z.number().optional(),
  url: z.string().optional(),
  ms: z.number().optional(),
  events: z.array(z.unknown()).optional(),
});

export type DriverResult = z.infer<typeof DriverResultSchema>;

export const terminateChildProcess = async (proc: ChildProcess | undefined): Promise<void> => {
  if (proc === undefined || proc.exitCode !== null) return;
  if (!proc.killed) {
    proc.kill('SIGKILL');
  }
  if (proc.exitCode !== null) return;
  await new Promise<void>(resolve => {
    proc.once('close', () => resolve());
    setTimeout(resolve, 2_000);
  });
};

export const stopDaemon = (buName: string, dir?: string, timeoutMs = 25_000) => {
  try {
    spawnSync(
      'uv',
      [
        'run',
        ...(dir !== undefined ? ['--project', dir] : []),
        'python',
        '-c',
        `from browser_harness.admin import restart_daemon; restart_daemon(${JSON.stringify(buName)})`,
      ],
      { timeout: timeoutMs },
    );
  } catch {
    // Daemon cleanup is best-effort
  }
};

export type CleanupOptions = {
  readonly pythonProcess?: ChildProcess;
  readonly chromeProcess?: ChildProcess;
  readonly buName?: string;
  readonly ultrafastDir?: string;
  readonly userDataDir?: string;
  readonly server?: { close: () => Promise<void> };
  readonly killProcess?: (proc: ChildProcess | undefined) => Promise<void>;
  readonly stopDaemon?: (buName: string, dir?: string, timeoutMs?: number) => void;
  readonly removeDir?: (dir: string) => void;
};

export const cleanupResources = async (options: CleanupOptions): Promise<void> => {
  const killProc = options.killProcess ?? terminateChildProcess;
  const stopD = options.stopDaemon ?? stopDaemon;
  const rm = options.removeDir ?? (dir => rmSync(dir, { recursive: true, force: true }));

  // 1. Kill and await the uv/Python child and Chromium first (they are ours)
  await Promise.all([killProc(options.pythonProcess), killProc(options.chromeProcess)]);

  // 2. Stop the daemon with timeout above the harness's own (>= 20s)
  if (options.buName !== undefined) {
    stopD(options.buName, options.ultrafastDir, 25_000);
  }

  // 3. Remove the profile
  if (options.userDataDir !== undefined) {
    try {
      rm(options.userDataDir);
    } catch {
      // Best effort removal on exit
    }
  }

  // 4. Close fixture server if open
  if (options.server !== undefined) {
    try {
      await options.server.close();
    } catch {
      // Best effort close
    }
  }
};
const run = async (): Promise<void> => {
  const taskName = parseArg('--task');
  if (taskName === undefined) {
    process.stderr.write('Error: --task is required\n');
    process.exit(1);
  }

  const ultrafastDirRaw = parseArg('--ultrafast-dir');
  if (ultrafastDirRaw === undefined) {
    process.stderr.write('Error: --ultrafast-dir is required\n');
    process.exit(1);
  }
  const ultrafastDir = resolve(ultrafastDirRaw);

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

  const tracePath = parseArg('--trace');
  const trace = tracePath === undefined ? undefined : recordTrace();

  const startTime = performance.now();

  const writeTrace = (record: RunRecord) => {
    if (tracePath === undefined || trace === undefined) return;
    const outcome = record.success ? 'success' : `failed: ${record.status} ${record.reason ?? ''}`;
    writeFileSync(
      tracePath,
      hideSecrets(
        taskDef,
        trace.render(`${record.task} ${record.variant} rep ${record.rep}: ${outcome}`),
      ),
    );
    writeFileSync(
      tracePath.replace(/\.md$/, '.json'),
      hideSecrets(taskDef, JSON.stringify({ record, events: trace.events() }, null, 2)),
    );
  };

  const emit = (record: RunRecord) => {
    writeTrace(record);
    process.stdout.write(`\n===BENCH_RESULT===\n${hideSecrets(taskDef, JSON.stringify(record))}\n`);
  };

  let chromeProcess: ChildProcess | undefined;
  let pythonProcess: ChildProcess | undefined;
  let currentBuName: string | undefined;
  let currentServer: FixtureServer | undefined;
  let currentUserDataDir: string | undefined;
  let isCleanedUp = false;

  const cleanupAll = async () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    await cleanupResources({
      pythonProcess,
      chromeProcess,
      buName: currentBuName,
      ultrafastDir,
      userDataDir: currentUserDataDir,
      server: currentServer,
    });
  };

  const onSigterm = async () => {
    await cleanupAll();
    process.exit(143);
  };

  const onSigint = async () => {
    await cleanupAll();
    process.exit(130);
  };

  process.on('SIGTERM', onSigterm);
  process.on('SIGINT', onSigint);
  try {
    const baseConfig = readConfigFile(parseArg('--config'));

    const apiKey = baseConfig.decisionModel.apiKey;
    const endpoint = baseConfig.decisionModel.endpoint;
    const modelName = baseConfig.decisionModel.name;

    const target = await (async () => {
      if (taskDef.fixture !== undefined) {
        const fixtureServer = await createFixtureServer();
        currentServer = fixtureServer;
        return {
          startUrl: `${fixtureServer.origin}/${taskDef.fixture.job}/${taskDef.fixture.layout}`,
        };
      }
      if (taskDef.startUrl !== undefined) {
        return {
          startUrl: taskDef.startUrl,
        };
      }
      throw new Error(`Task "${taskName}" has neither fixture nor startUrl`);
    })();

    const userDataDir = mkdtempSync(join(tmpdir(), 'uf-chrome-'));
    currentUserDataDir = userDataDir;

    const chrome = spawn(chromium.executablePath(), [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--window-size=1440,900',
      'about:blank',
    ]);
    chromeProcess = chrome;

    let chromeExited = false;
    let chromeExitCode: number | null = null;
    chrome.on('exit', code => {
      chromeExited = true;
      chromeExitCode = code;
    });

    const devToolsFile = join(userDataDir, 'DevToolsActivePort');
    let port: number | undefined;
    for (let i = 0; i < 50; i++) {
      if (chromeExited) {
        throw new Error(`Chromium exited prematurely with code ${chromeExitCode ?? 'null'}`);
      }
      if (existsSync(devToolsFile)) {
        try {
          const lines = readFileSync(devToolsFile, 'utf8').trim().split('\n');
          const portNum = Number(lines[0]);
          if (Number.isInteger(portNum) && portNum > 0) {
            port = portNum;
            break;
          }
        } catch {
          // File may still be being written
        }
      }
      await sleep(100);
    }

    if (port === undefined) {
      throw new Error('Chromium failed to write DevToolsActivePort within 5 seconds');
    }

    const buName = `uf-${process.pid}-${port}`;
    currentBuName = buName;

    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/json/version`);
        break;
      } catch {
        await sleep(100);
      }
    }

    const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const contexts = cdp.contexts();
    const firstContext = contexts[0];
    if (firstContext === undefined) {
      throw new Error('CDP connection has no browser context');
    }

    const probe = await firstContext.newPage();
    await probe.goto(target.startUrl);
    let expected: string | undefined;
    try {
      expected = taskDef.expected === undefined ? undefined : await taskDef.expected(probe);
    } catch (expectedError) {
      await probe.close();
      await cdp.close();
      const reason = expectedError instanceof Error ? expectedError.message : String(expectedError);
      emit({
        task: taskDef.name,
        variant: 'ultrafast',
        rep,
        success: false,
        status: 'infra',
        reason: `Failed to compute expected: ${reason}`,
        steps: { count: 0, names: [] },
        usage: { requests: 0, inputTokens: 0 },
        wallClockMs: Math.round(performance.now() - startTime),
        firstRoundOpsSize: { topLevel: 0, leaves: 0 },
      });
      return;
    }
    await probe.close();

    const driverPath = join(__dirname, 'ultrafast', 'driver.py');
    const goalText = buildGoalText(taskDef);
    const timeoutMs = 180_000;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...((process.env.TYPESAFE_API_KEY ?? apiKey)
        ? { TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY ?? apiKey }
        : {}),
      ...((process.env.TYPESAFE_URL ?? endpoint)
        ? { TYPESAFE_URL: process.env.TYPESAFE_URL ?? endpoint }
        : {}),
      ...((process.env.TYPESAFE_MODEL ?? modelName)
        ? { TYPESAFE_MODEL: process.env.TYPESAFE_MODEL ?? modelName }
        : {}),
      ...((process.env.TEXT_MODEL_API_KEY ?? apiKey)
        ? { TEXT_MODEL_API_KEY: process.env.TEXT_MODEL_API_KEY ?? apiKey }
        : {}),
      TEXT_MODEL_BASE_URL: process.env.TEXT_MODEL_BASE_URL ?? 'https://openrouter.ai/api/v1',
      TEXT_MODEL: process.env.TEXT_MODEL ?? 'inception/mercury-2.5',
      TEXT_MODEL_REASONING: process.env.TEXT_MODEL_REASONING ?? 'none',
      BU_CDP_URL: `http://127.0.0.1:${port}`,
      BU_NAME: buName,
    };

    const out = await new Promise<string>(resolveOut => {
      const child = spawn(
        'uv',
        ['run', '--project', ultrafastDir, 'python', driverPath, target.startUrl, goalText, '40'],
        { env },
      );
      pythonProcess = child;
      let output = '';
      child.stdout.on('data', d => {
        output += String(d);
      });
      child.stderr.on('data', d => {
        output += String(d);
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 3000);
        child.once('close', () => clearTimeout(killTimer));
      }, timeoutMs);
      child.on('close', () => {
        clearTimeout(timer);
        pythonProcess = undefined;
        resolveOut(output);
      });
    });

    const marker = '===UF_RESULT===';
    const markerIdx = out.indexOf(marker);
    const driverResult: DriverResult = (() => {
      if (markerIdx === -1) {
        return { status: 'crashed', error: out.slice(-500) };
      }
      const jsonLine = out
        .slice(markerIdx + marker.length)
        .trim()
        .split('\n')[0];
      if (jsonLine === undefined || jsonLine.length === 0) {
        return { status: 'crashed', error: out.slice(-500) };
      }
      try {
        const parsed = JSON.parse(jsonLine);
        const validated = DriverResultSchema.safeParse(parsed);
        return validated.success
          ? validated.data
          : { status: 'crashed', error: `Driver output malformed: ${validated.error.message}` };
      } catch {
        return { status: 'crashed', error: out.slice(-500) };
      }
    })();

    if (trace !== undefined && Array.isArray(driverResult.events)) {
      for (const rawEvent of driverResult.events) {
        const validatedEvent = EventSchema.safeParse(rawEvent);
        if (validatedEvent.success) {
          trace.add(validatedEvent.data);
        }
      }
    }

    const rawError = driverResult.error ?? '';
    const isInfra = rawError.includes('_IPCResponseTimeout') || out.includes('_IPCResponseTimeout');

    const allPages = cdp.contexts().flatMap(c => c.pages());
    const activePage =
      allPages.find(p => driverResult.url !== undefined && p.url() === driverResult.url) ??
      allPages.find(p => p.url() !== 'about:blank');

    const success =
      activePage === undefined
        ? false
        : await taskDef.isDone(activePage, currentServer, expected).catch(() => false);

    await cdp.close();

    const actionList = Array.isArray(driverResult.actions)
      ? driverResult.actions.filter((a): a is string => typeof a === 'string')
      : [];

    const status = isInfra ? 'infra' : (driverResult.status ?? 'error');
    const reason = (() => {
      if (isInfra) return 'harness timeout (_IPCResponseTimeout)';
      return rawError.length > 0 ? rawError : undefined;
    })();

    emit({
      task: taskDef.name,
      variant: 'ultrafast',
      rep,
      success,
      status,
      ...(reason !== undefined ? { reason } : {}),
      steps: { count: actionList.length, names: actionList },
      usage: {
        requests: driverResult.requests ?? 0,
        inputTokens: driverResult.inputTokens ?? 0,
      },
      wallClockMs: driverResult.ms ?? Math.round(performance.now() - startTime),
      claimedDone: driverResult.status === 'done',
      firstRoundOpsSize: { topLevel: 0, leaves: 0 },
    });
  } catch (error) {
    const wallClockMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    const isInfra = message.includes('_IPCResponseTimeout');
    emit({
      task: taskDef.name,
      variant: 'ultrafast',
      rep,
      success: false,
      status: isInfra ? 'infra' : 'error',
      reason: message,
      steps: { count: 0, names: [] },
      usage: { requests: 0, inputTokens: 0 },
      wallClockMs,
      firstRoundOpsSize: { topLevel: 0, leaves: 0 },
    });
  } finally {
    await cleanupAll();
    process.off('SIGTERM', onSigterm);
    process.off('SIGINT', onSigint);
  }
};

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  run().catch(err => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
