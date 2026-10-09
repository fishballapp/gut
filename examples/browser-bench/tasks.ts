import { secret } from '@gut.run/playwright';
import type { Page } from 'playwright';
import type { FixtureServer, JobName, LayoutName } from '../browser-fixtures/index.ts';

export type FixtureSpec = {
  readonly job: JobName;
  readonly layout: LayoutName;
};

export type BenchmarkTask = {
  readonly name: string;
  readonly instruction: string;
  readonly goal: string;
  readonly isDone: (page: Page, server?: FixtureServer, expected?: string) => Promise<boolean>;
  readonly expected?: (page: Page) => Promise<string>;
  readonly fixture?: FixtureSpec;
  readonly startUrl?: string;
  /** What a caller knows before the run: the values to enter. */
  readonly values?: Readonly<Record<string, string>>;
  /** Values the model must never read, such as a password. */
  readonly secrets?: Readonly<Record<string, string>>;
};

/** What a run passes to `observe`: the values, and the secrets wrapped in `secret()`. */
export const observeValues = ({ values, secrets }: BenchmarkTask) => ({
  ...values,
  ...Object.fromEntries(
    Object.entries(secrets ?? {}).map(([what, value]) => [what, secret(value)]),
  ),
});

/**
 * `text` with the task's secrets replaced, for anything a run saves or prints: each secret as typed,
 * as JSON escapes it inside a string, and as a URL encodes it.
 */
export const hideSecrets = ({ secrets }: BenchmarkTask, text: string): string =>
  Object.values(secrets ?? {})
    .filter(value => value.length > 0)
    .flatMap(value => [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)])
    .toSorted((a, b) => b.length - a.length)
    .reduce((hidden, form) => hidden.replaceAll(form, '[secret]'), text);

const JOBS: readonly JobName[] = ['docs', 'directory', 'form', 'delayed'];
const LAYOUTS: readonly LayoutName[] = ['layout-a', 'layout-b'];

const instructions: Record<JobName, string> = {
  docs: 'You are helping the user navigate documentation to reach the rate limits documentation page',
  directory:
    'You are helping the user find the contact email for the Manchester office in the directory',
  form: 'You are helping the user submit a flight search form for Tokyo on 2026-10-15',
  delayed: 'You are helping the user view delayed results once reports finish loading',
};

const goals: Record<JobName, string> = {
  docs: 'The documentation page heading is "Rate limits"',
  directory: 'The page shows the contact email for the Manchester office',
  form: 'The flight search has been submitted for Tokyo on 2026-10-15',
  delayed: 'The delayed results are displayed on the page',
};

export const fixtureTasks: readonly BenchmarkTask[] = JOBS.flatMap(job =>
  LAYOUTS.map(
    (layout): BenchmarkTask => ({
      name: `${job}-${layout}`,
      fixture: { job, layout },
      instruction: instructions[job],
      goal: goals[job],
      ...(job === 'form' ? { values: { destination: 'Tokyo', date: '2026-10-15' } } : {}),
      isDone: async (page, server) => {
        if (server === undefined) {
          throw new Error(`Server required for fixture task ${job}-${layout}`);
        }
        return server.oracle.isDone(job, layout, page.url());
      },
    }),
  ),
);

// Live tasks from how people use Jev for browsing (tmp/gut-jev-browser-usecases.md).
export const normalizeUrl = (url: string): string => {
  const withoutHash = url.split('#')[0] ?? '';
  return withoutHash.endsWith('/') ? withoutHash.slice(0, -1) : withoutHash;
};

export const matchesUrl = (actual: string, expected: string): boolean =>
  normalizeUrl(actual) === normalizeUrl(expected);

const pathOf = (page: Page) => decodeURIComponent(new URL(page.url()).pathname);

export const liveTasks: readonly BenchmarkTask[] = [
  {
    name: 'wiki-search-godel',
    startUrl: 'https://en.wikipedia.org/wiki/Main_Page',
    instruction:
      "You are helping the user open the Wikipedia article about Gödel's incompleteness theorems",
    goal: "The Wikipedia article about Gödel's incompleteness theorems is open",
    values: { 'search query': "Gödel's incompleteness theorems" },
    isDone: async page => pathOf(page) === "/wiki/Gödel's_incompleteness_theorems",
  },
  {
    name: 'wiki-race-eiffel',
    startUrl: 'https://en.wikipedia.org/wiki/Rubber_duck',
    instruction:
      'You are racing to the Wikipedia article about the Eiffel Tower using only links on the pages',
    goal: 'The Wikipedia article about the Eiffel Tower is open',
    isDone: async page => pathOf(page) === '/wiki/Eiffel_Tower',
  },
  {
    name: 'hn-top-comments',
    startUrl: 'https://news.ycombinator.com',
    instruction:
      'You are helping the user open the comments page of the top story on the Hacker News front page',
    goal: 'The comments page of the top story is open',
    expected: async page => {
      const id = await page.locator('tr.athing').first().getAttribute('id');
      if (id === null || id.length === 0) {
        throw new Error('Could not find the top story id on Hacker News');
      }
      return `https://news.ycombinator.com/item?id=${id}`;
    },
    isDone: async (page, _server, expected) =>
      expected !== undefined && matchesUrl(page.url(), expected),
  },
  {
    name: 'hn-faq',
    startUrl: 'https://news.ycombinator.com',
    instruction: 'You are helping the user open the Hacker News FAQ',
    goal: 'The Hacker News FAQ is open',
    isDone: async page => pathOf(page) === '/newsfaq.html',
  },
  {
    name: 'github-releases',
    startUrl: 'https://github.com/browser-use/browser-use',
    instruction: 'You are helping the user open the newest release of this repository',
    goal: 'The newest release of browser-use/browser-use is open',
    expected: async page => {
      const href = await page.locator('a[href*="/releases/tag/"]').first().getAttribute('href');
      if (href === null) {
        throw new Error('Could not find Latest release link on GitHub');
      }
      return new URL(href, page.url()).href;
    },
    isDone: async (page, _server, expected) =>
      expected !== undefined && matchesUrl(page.url(), expected),
  },
  {
    name: 'github-trending',
    startUrl: 'https://github.com',
    instruction: "You are helping the user open GitHub's Trending repositories page",
    goal: "GitHub's Trending repositories page is open",
    isDone: async page => pathOf(page) === '/trending' && new URL(page.url()).search === '',
  },
  {
    name: 'arxiv-gpt4',
    startUrl: 'https://arxiv.org',
    instruction:
      'You are helping the user open the arXiv abstract page of the paper "GPT-4 Technical Report"',
    goal: 'The arXiv abstract page of "GPT-4 Technical Report" is open',
    values: { 'search query': 'GPT-4 Technical Report' },
    isDone: async page => pathOf(page).startsWith('/abs/2303.08774'),
  },
  {
    name: 'saucedemo-checkout',
    startUrl: 'https://www.saucedemo.com',
    instruction:
      'You are helping the user log in, add "Sauce Labs Backpack" and "Sauce Labs Bike Light" to the cart, and check out as Ada Lovelace, postal code N1 9GU, stopping on the checkout overview without finishing',
    goal: 'The checkout overview lists Sauce Labs Backpack and Sauce Labs Bike Light',
    values: {
      username: 'standard_user',
      'first name': 'Ada',
      'last name': 'Lovelace',
      'postal code': 'N1 9GU',
    },
    secrets: { password: 'secret_sauce' },
    isDone: async page => {
      if (pathOf(page) !== '/checkout-step-two.html') return false;
      const items = page.locator('.cart_list .inventory_item_name');
      await items
        .first()
        .waitFor({ timeout: 2_000 })
        .catch(() => undefined);
      const names = await items.allInnerTexts();
      return [...names].sort().join('\n') === 'Sauce Labs Backpack\nSauce Labs Bike Light';
    },
  },
];

export const allTasks: readonly BenchmarkTask[] = [...fixtureTasks, ...liveTasks];
