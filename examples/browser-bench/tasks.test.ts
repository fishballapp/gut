import { chromium, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { type BenchmarkTask, hideSecrets, liveTasks, matchesUrl, observeValues } from './tasks.ts';

describe('matchesUrl', () => {
  it('compares URLs ignoring trailing slash and hash', () => {
    expect(
      matchesUrl(
        'https://news.ycombinator.com/item?id=123/',
        'https://news.ycombinator.com/item?id=123',
      ),
    ).toBe(true);
    expect(
      matchesUrl(
        'https://news.ycombinator.com/item?id=123#comments',
        'https://news.ycombinator.com/item?id=123',
      ),
    ).toBe(true);
    expect(
      matchesUrl(
        'https://news.ycombinator.com/item?id=123/#comments',
        'https://news.ycombinator.com/item?id=123',
      ),
    ).toBe(true);
    expect(
      matchesUrl(
        'https://news.ycombinator.com/item?id=123',
        'https://news.ycombinator.com/item?id=456',
      ),
    ).toBe(false);
    expect(
      matchesUrl(
        'https://github.com/browser-use/browser-use/releases',
        'https://github.com/browser-use/browser-use/releases/tag/v0.1.40',
      ),
    ).toBe(false);
  });
});

// The live tasks' own checks, on stand-in pages served by Playwright's router (no network).
describe('live task checks', () => {
  const taskNamed = (name: string) => {
    const found = liveTasks.find(task => task.name === name);
    if (found === undefined) throw new Error(`no task ${name}`);
    return found;
  };

  const withPage = async (
    pages: Readonly<Record<string, string>>,
    use: (page: Page) => Promise<void>,
  ) => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(500);
    await page.route('**/*', route => {
      const body = pages[route.request().url()];
      return body === undefined
        ? route.fulfill({ status: 404, body: 'not found' })
        : route.fulfill({ contentType: 'text/html', body });
    });
    try {
      await use(page);
    } finally {
      await browser.close();
    }
  };

  it("hn-top-comments counts only the top story's comments", async () => {
    const task = taskNamed('hn-top-comments');
    await withPage(
      {
        'https://news.ycombinator.com/':
          '<table><tr class="athing" id="42"></tr><tr class="athing" id="43"></tr></table>',
        'https://news.ycombinator.com/item?id=42': 'top story',
        'https://news.ycombinator.com/item?id=43': 'second story',
      },
      async page => {
        await page.goto('https://news.ycombinator.com/');
        const expected = await task.expected?.(page);
        expect(expected).toBe('https://news.ycombinator.com/item?id=42');
        await page.goto('https://news.ycombinator.com/item?id=43');
        expect(await task.isDone(page, undefined, expected)).toBe(false);
        await page.goto('https://news.ycombinator.com/item?id=42');
        expect(await task.isDone(page, undefined, expected)).toBe(true);
      },
    );
  });

  it('github-releases counts only the newest release, not the release list', async () => {
    const task = taskNamed('github-releases');
    const repo = 'https://github.com/browser-use/browser-use';
    await withPage(
      {
        [repo]: `<a href="/browser-use/browser-use/releases">Releases</a>
          <a href="/browser-use/browser-use/releases/tag/0.13.11">0.13.11 Latest</a>`,
        [`${repo}/releases`]: 'all releases',
        [`${repo}/releases/tag/0.13.11`]: 'newest release',
      },
      async page => {
        await page.goto(repo);
        const expected = await task.expected?.(page);
        expect(expected).toBe(`${repo}/releases/tag/0.13.11`);
        await page.goto(`${repo}/releases`);
        expect(await task.isDone(page, undefined, expected)).toBe(false);
        await page.goto(`${repo}/releases/tag/0.13.11`);
        expect(await task.isDone(page, undefined, expected)).toBe(true);
      },
    );
  });

  it('github-trending counts only the trending repositories page', async () => {
    const task = taskNamed('github-trending');
    await withPage(
      {
        'https://github.com/trending': 'repositories',
        'https://github.com/trending/developers': 'developers',
        'https://github.com/trending?since=weekly': 'this week',
      },
      async page => {
        await page.goto('https://github.com/trending/developers');
        expect(await task.isDone(page)).toBe(false);
        await page.goto('https://github.com/trending?since=weekly');
        expect(await task.isDone(page)).toBe(false);
        await page.goto('https://github.com/trending');
        expect(await task.isDone(page)).toBe(true);
      },
    );
  });

  it('saucedemo-checkout counts only an overview of exactly the two products', async () => {
    const task = taskNamed('saucedemo-checkout');
    const overview = (names: readonly string[]) =>
      `<div class="cart_list">${names.map(name => `<div class="cart_item"><div class="inventory_item_name">${name}</div></div>`).join('')}</div>`;
    const url = 'https://www.saucedemo.com/checkout-step-two.html';
    for (const [names, isDone] of [
      [['Sauce Labs Bike Light', 'Sauce Labs Backpack'], true],
      [['Sauce Labs Backpack'], false],
      [['Sauce Labs Backpack', 'Sauce Labs Bike Light', 'Sauce Labs Onesie'], false],
    ] as const) {
      await withPage({ [url]: overview(names) }, async page => {
        await page.goto(url);
        expect(await task.isDone(page)).toBe(isDone);
      });
    }
  });

  it('fails the run up front when the target cannot be found', async () => {
    const task = taskNamed('hn-top-comments');
    await withPage({ 'https://news.ycombinator.com/': '<p>no stories</p>' }, async page => {
      await page.goto('https://news.ycombinator.com/');
      await expect(task.expected?.(page)).rejects.toThrow();
    });
  });
});

describe("a task's secrets", () => {
  const task: BenchmarkTask = {
    name: 'login',
    instruction: 'Log in',
    goal: 'Logged in',
    isDone: async () => true,
    values: { username: 'standard_user' },
    secrets: { password: 'secret_sauce' },
  };

  it('are hidden as JSON escapes them and as a URL encodes them', () => {
    const quoted: BenchmarkTask = { ...task, secrets: { password: 'p"a\\ss word' } };
    const saved = JSON.stringify({
      typed: 'p"a\\ss word',
      url: `/login?pw=${encodeURIComponent('p"a\\ss word')}`,
    });
    expect(hideSecrets(quoted, saved)).toBe('{"typed":"[secret]","url":"/login?pw=[secret]"}');
  });

  it('are hidden from what a run saves and prints', () => {
    expect(hideSecrets(task, '{"reason":"secret_sauce was rejected","user":"standard_user"}')).toBe(
      '{"reason":"[secret] was rejected","user":"standard_user"}',
    );
  });

  it('reach observe wrapped in secret(), beside the plain values', () => {
    const values = observeValues(task);
    expect(values.username).toBe('standard_user');
    expect(typeof values.password).toBe('object');
    expect(JSON.stringify(values)).not.toContain('secret_sauce');
  });
});
