import { isOp, type Op, type Ops } from '@gut.run/core';
import { observe } from '@gut.run/playwright';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixtureServer, type FixtureServer } from './server.ts';

const findLeafOp = (ops: Ops, predicate: (op: Op) => boolean): Op | undefined => {
  for (const entry of Object.values(ops)) {
    if (!isOp(entry)) continue;
    if (entry.kind === 'leaf' && predicate(entry)) return entry;
    if (entry.kind === 'node') {
      const found = findLeafOp(entry.ops, predicate);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

const findGroup = (ops: Ops, description: string): Ops | undefined => {
  for (const entry of Object.values(ops)) {
    if (!isOp(entry)) continue;
    if (entry.kind === 'node') {
      if (entry.description.toLowerCase().includes(description.toLowerCase())) return entry.ops;
      const found = findGroup(entry.ops, description);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

// Starting or closing Chromium can outlast vitest's 10 s hook default while the whole repo's tests run.
const BROWSER_HOOK_TIMEOUT_MS = 30_000;

describe('browser fixtures oracle verification', () => {
  let browser: Browser;
  let server: FixtureServer;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    server = await createFixtureServer();
  }, BROWSER_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await browser.close();
    await server.close();
  }, BROWSER_HOOK_TIMEOUT_MS);

  it('solves docs job on layout-a (2 clicks: Home -> API Reference -> Rate limits)', async () => {
    server.oracle.reset();
    const page = await browser.newPage();
    try {
      await page.goto(`${server.origin}/docs/layout-a`);

      // First click: API Reference
      let { ops } = await observe(page);
      const apiRefOp = findLeafOp(ops, o => o.description.includes('API Reference'));
      expect(apiRefOp).toBeDefined();
      if (apiRefOp?.kind === 'leaf') {
        await apiRefOp.invoke?.();
      }
      await page.waitForURL('**/docs/layout-a/api-reference');

      // Second click: Rate limits
      ({ ops } = await observe(page));
      const rateLimitsOp = findLeafOp(ops, o => o.description.includes('Rate limits'));
      expect(rateLimitsOp).toBeDefined();
      if (rateLimitsOp?.kind === 'leaf') {
        await rateLimitsOp.invoke?.();
      }
      await page.waitForURL('**/docs/layout-a/rate-limits');
      expect(server.oracle.isDone('docs', 'layout-a', page.url())).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('solves docs job on layout-b (2 clicks: Home -> Quotas & Limits -> Rate limits)', async () => {
    server.oracle.reset();
    const page = await browser.newPage();
    try {
      await page.goto(`${server.origin}/docs/layout-b`);

      // First click: Quotas & Limits
      let { ops } = await observe(page);
      const quotasOp = findLeafOp(ops, o => o.description.includes('Quotas & Limits'));
      expect(quotasOp).toBeDefined();
      if (quotasOp?.kind === 'leaf') {
        await quotasOp.invoke?.();
      }
      await page.waitForURL('**/docs/layout-b/quotas');

      // Second click: Rate limits
      ({ ops } = await observe(page));
      const rateLimitsOp = findLeafOp(ops, o => o.description.includes('Rate limits'));
      expect(rateLimitsOp).toBeDefined();
      if (rateLimitsOp?.kind === 'leaf') {
        await rateLimitsOp.invoke?.();
      }
      await page.waitForURL('**/docs/layout-b/rate-limits');
      expect(server.oracle.isDone('docs', 'layout-b', page.url())).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('solves directory job on layout-a and layout-b', async () => {
    for (const layout of ['layout-a', 'layout-b'] as const) {
      server.oracle.reset();
      const page = await browser.newPage();
      try {
        await page.goto(`${server.origin}/directory/${layout}`);
        const { ops } = await observe(page);
        const manchesterGroup = findGroup(ops, 'Manchester');
        expect(manchesterGroup).toBeDefined();

        const detailsOp = findLeafOp(manchesterGroup!, o => o.description.includes('Details'));
        expect(detailsOp).toBeDefined();
        if (detailsOp?.kind === 'leaf') {
          await detailsOp.invoke?.();
        }

        await page.waitForURL(`**/directory/${layout}/manchester`);
        expect(server.oracle.isDone('directory', layout, page.url())).toBe(true);
      } finally {
        await page.close();
      }
    }
  });

  it('solves form job on layout-a and layout-b with oracle verifying submitted values', async () => {
    for (const layout of ['layout-a', 'layout-b'] as const) {
      server.oracle.reset();
      const page = await browser.newPage();
      try {
        await page.goto(`${server.origin}/form/${layout}`);

        // Fill destination
        let { ops } = await observe(page, {
          values: { destination: 'Tokyo', date: '2026-10-15' },
        });
        const destOp = findLeafOp(ops, o => o.description.includes('Destination'));
        expect(destOp).toBeDefined();
        if (destOp?.kind === 'leaf' && destOp.choices !== undefined) {
          await destOp.choices.find(c => c.label.includes('Tokyo'))?.invoke();
        }

        // Fill date
        ({ ops } = await observe(page, {
          values: { destination: 'Tokyo', date: '2026-10-15' },
        }));
        const dateOp = findLeafOp(ops, o => o.description.includes('Date'));
        expect(dateOp).toBeDefined();
        if (dateOp?.kind === 'leaf' && dateOp.choices !== undefined) {
          await dateOp.choices.find(c => c.label.includes('2026-10-15'))?.invoke();
        }

        // Submit form
        ({ ops } = await observe(page));
        const submitOp = findLeafOp(
          ops,
          o => o.description.includes('Search Flights') || o.description.includes('Find Flights'),
        );
        expect(submitOp).toBeDefined();
        if (submitOp?.kind === 'leaf') {
          await submitOp.invoke?.();
        }

        await page.waitForURL(`**/form/${layout}/search`);
        expect(server.oracle.isDone('form', layout, page.url())).toBe(true);
      } finally {
        await page.close();
      }
    }
  });

  it('solves delayed job on layout-a and layout-b with aria-busy wait', async () => {
    for (const layout of ['layout-a', 'layout-b'] as const) {
      server.oracle.reset();
      const page = await browser.newPage();
      try {
        await page.goto(`${server.origin}/delayed/${layout}`);
        let { ops } = await observe(page);

        // Close modal / dismiss notice
        const dismissOp = findLeafOp(
          ops,
          o => o.description.includes('Accept All') || o.description.includes('Dismiss'),
        );
        expect(dismissOp).toBeDefined();
        if (dismissOp?.kind === 'leaf') {
          await dismissOp.invoke?.();
        }

        // observe() will wait for aria-busy region (~800ms) to clear!
        ({ ops } = await observe(page));
        const actionOp = findLeafOp(
          ops,
          o => o.description.includes('View Results') || o.description.includes('Access Reports'),
        );
        expect(actionOp).toBeDefined();
        if (actionOp?.kind === 'leaf') {
          await actionOp.invoke?.();
        }

        await page.waitForFunction(
          () => document.body.innerText.includes('Delayed Complete'),
          null,
          { timeout: 3_000 },
        );
        expect(server.oracle.isDone('delayed', layout, page.url())).toBe(true);
      } finally {
        await page.close();
      }
    }
  }, 15_000);
});
