import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

// `gut run --inspect` on the counter, played in Step through the page: every turn and pick is ours.
// The run starts with no decision model, so every turn waits for us. The CLI gets an empty HOME and
// cwd, so no gut.config.json (one may sit in a developer's home) gives it a model.

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const CLI_ENTRY = fileURLToPath(new URL('../../cli/src/bin/cli.ts', import.meta.url));
const TASK_FILE = fileURLToPath(new URL('../../../examples/counter.gut.ts', import.meta.url));

const execFileAsync = promisify(execFile);

let inspector: ChildProcess | undefined;
let home: string | undefined;
let inspectorUrl: string | undefined;

// No `--port`: the OS picks a free one, and the printed URL names it.
const spawnInspector = (cwd: string) =>
  spawn(process.execPath, [CLI_ENTRY, 'run', TASK_FILE, '--inspect', '--no-open'], {
    cwd,
    env: { ...process.env, HOME: cwd },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** The CLI prints `gut inspector: <url>` on stderr once its server is listening. */
const urlOf = (child: ReturnType<typeof spawnInspector>) =>
  new Promise<string>((resolve, reject) => {
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      const match = /gut inspector: (\S+)/.exec(stderr);
      if (match?.[1] !== undefined) resolve(match[1]);
    });
    child.once('exit', code => {
      reject(new Error(`gut run --inspect exited with ${code}:\n${stderr}`));
    });
  });

/** Asks the CLI to stop, and kills it if it has not gone within five seconds. */
const stopInspector = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const killer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  child.kill('SIGTERM');
  await once(child, 'exit');
  clearTimeout(killer);
};

test.beforeAll(async () => {
  // Built here, not left to a prior `pnpm build`: gut's CI runs the tests before it builds.
  await execFileAsync('pnpm', ['build'], { cwd: PACKAGE_DIR });
  home = await mkdtemp(`${tmpdir()}/gut-inspector-e2e-`);
  // Held before the URL arrives, so afterAll stops a CLI that never prints one.
  const child = spawnInspector(home);
  inspector = child;
  inspectorUrl = await urlOf(child);
});

test.afterAll(async () => {
  if (inspector !== undefined) await stopInspector(inspector);
  if (home !== undefined) await rm(home, { recursive: true, force: true });
});

test('plays the counter to its end in Step, by mouse and by keyboard', async ({ page }) => {
  if (inspectorUrl === undefined) throw new Error('the inspector did not start');
  await page.goto(inspectorUrl);

  await test.step('the run waits for us at its first turn, with no model', async () => {
    await expect(page.getByText('The counter is 3').first()).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Your turn · round 1' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'What should happen next?' })).toBeVisible();
  });

  await test.step('round 1: answer by keyboard, a digit then ↵', async () => {
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'Before the step · round 1' }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Confirm/ }).click();
  });

  await test.step('round 2: answer by mouse, then Confirm the pick', async () => {
    await expect(page.getByRole('button', { name: 'round 2', exact: true })).toBeVisible();
    await page
      .getByRole('radiogroup', { name: 'What should happen next?' })
      .getByRole('radio', { name: 'Add one' })
      .click();
    await page.getByRole('button', { name: /^Answer/ }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Before the step · round 2' }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Confirm/ }).click();
  });

  await test.step('round 3: the last move, then the run ends', async () => {
    await expect(page.getByRole('button', { name: 'round 3', exact: true })).toBeVisible();
    await page
      .getByRole('radiogroup', { name: 'What should happen next?' })
      .getByRole('radio', { name: 'Add one' })
      .click();
    await page.getByRole('button', { name: /^Answer/ }).click();
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await expect(page.getByText(/^Achieved in \d+ rounds?$/)).toBeVisible();
  });
});

test('moving the options slider in Step re-picks the waiting question at the new size', async ({
  page,
}) => {
  if (inspectorUrl === undefined) throw new Error('the inspector did not start');
  await page.goto(inspectorUrl);
  await page.getByRole('button', { name: 'Restart' }).click();

  const question = page.getByRole('radiogroup', { name: 'What should happen next?' });
  await expect(question).toBeVisible();
  const sizeBefore = await question.getByRole('radio').count();
  expect(sizeBefore).toBeGreaterThan(2);

  // The keyboard commits on release, so the question is asked again once Home is let go.
  const slider = page.getByRole('slider', { name: 'Options' });
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await expect(question.getByRole('radio')).toHaveCount(2);
});

test('edits what the model reads in Step: the edited text is asked again, and the round reads as edited', async ({
  page,
}) => {
  if (inspectorUrl === undefined) throw new Error('the inspector did not start');
  const question = page.getByRole('radiogroup', { name: 'What should happen next?' });
  const slider = page.getByRole('slider', { name: 'Options' });

  // Each slider move re-picks the question, and the count of its options says the re-pick landed:
  // at the top, "Add one" is a move, not a bundle. Waiting on the count keeps E from reaching an
  // older question, which a re-pick would then drop with its draft.
  await page.goto(inspectorUrl);
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(question.getByRole('radio')).toHaveCount(2);
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '255');
  await expect(question.getByRole('radio')).toHaveCount(14);
  // A fresh page, so no control keeps focus and the page takes E.
  await page.goto(inspectorUrl);
  await expect(question.getByRole('radio')).toHaveCount(14);

  await test.step('E opens the edits on the waiting pick, and a changed text is counted', async () => {
    await page.keyboard.press('e');
    await page.getByRole('textbox', { name: 'Description of add' }).fill('Add one more');
    await expect(page.getByText('1 change', { exact: true })).toBeVisible();
  });

  await test.step('Pick again with edits asks the question again with the edited text', async () => {
    await page.getByRole('button', { name: /^Pick again with edits/ }).click();
    await expect(question.getByRole('radio', { name: /Add one more/ })).toBeVisible();
    await expect(page.getByText(/with edits/)).toBeVisible();
  });

  await test.step('answer it and Confirm, then the round reads as edited, with its copy-back', async () => {
    await question.getByRole('radio', { name: /Add one more/ }).click();
    await page.getByRole('button', { name: /^Answer/ }).click();
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await page.getByRole('button', { name: 'round 1', exact: true }).click();
    await expect(
      page.getByRole('navigation', { name: 'Rounds' }).getByText('edited'),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Copy into your task' })).toContainText(
      'add: "Add one" → "Add one more"',
    );
  });
});

test('a slider move re-picks the question, and keeps the edits being made', async ({ page }) => {
  if (inspectorUrl === undefined) throw new Error('the inspector did not start');
  await page.goto(inspectorUrl);
  const question = page.getByRole('radiogroup', { name: 'What should happen next?' });
  const slider = page.getByRole('slider', { name: 'Options' });
  const description = page.getByRole('textbox', { name: /^Description of add$/ });
  await expect(question).toBeVisible();

  await page.keyboard.press('e');
  await description.fill('Add a lot');
  await expect(page.getByText('1 change', { exact: true })).toBeVisible();

  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await expect(question.getByRole('radio')).toHaveCount(2);
  await expect(description).toHaveValue('Add a lot');
  await expect(page.getByText('1 change', { exact: true })).toBeVisible();
});
