/**
 * Orchestration of DOM settling, snapshot parsing, scoping, and observe().
 */

import type { Ops } from '@gut.run/core';
import type { Frame, Locator, Page } from 'playwright';
import { buildFields, formatVisibleText, type PageContext } from './context.ts';
import { buildControlOps, type CandidateWithField, takeFailedMove } from './ops.ts';
import { type Control, collectSnapshot, FILL_ROLES } from './paths.ts';
import { createRedactor, type Secret } from './secret.ts';
import {
  ariaSnapshotRootSchema,
  isCovered,
  isNavigationError,
  readField,
  redactSnapshot,
  refsInside,
  resolveHref,
  waitForAriaBusyQuiet,
  waitForDomQuiet,
} from './snapshot.ts';

export type ObserveOptions = {
  readonly values?: Readonly<Record<string, string | Secret>>;
  readonly shouldOffer?: (control: Control) => boolean;
};

const isLocator = (target: Page | Locator): target is Locator =>
  'page' in target && typeof target.page === 'function';

/** How long `observe` keeps re-reading a page that navigates while it reads. */
const NAVIGATION_DEADLINE_MS = 10_000;

/** How long `observe` keeps re-reading a page with every control covered, and how often. */
const COVERED_DEADLINE_MS = 3_000;
const COVERED_RETRY_MS = 250;

/** A read of the page: what a round returns, and whether a click could reach none of it. */
type PageRead = { context: PageContext; ops: Ops; isEverythingCovered: boolean };

/** The page navigated while `observe` read it, so what it read may mix two pages. */
class NavigatedError extends Error {}

/**
 * Reads the page once. A click can start a navigation after settling: a read then fails, falls
 * back, or waits for a control the new page doesn't have. So a navigation of the main frame aborts
 * the reads still waiting and throws, for `observe` to read the page again.
 */
const readPage = async (
  target: Page | Locator,
  page: Page,
  options: ObserveOptions | undefined,
): Promise<PageRead> => {
  const isTargetLocator = isLocator(target);
  if (isTargetLocator) {
    const count = await target.count();
    if (count === 0) {
      throw new Error('observe: locator matched 0 elements; expected exactly 1');
    }
    if (count > 1) {
      throw new Error(`observe: locator matched ${count} elements; expected exactly 1`);
    }
  }

  // Listening from before settling: a navigation that lands after settling checked the page
  // would otherwise leave the new page, maybe still empty, read as settled.
  const navigation = new AbortController();
  const onNavigated = (frame: Frame) => {
    if (frame === page.mainFrame()) navigation.abort();
  };
  page.on('framenavigated', onNavigated);
  try {
    await waitForDomQuiet(page);
    const isStillBusy = await waitForAriaBusyQuiet(page);
    // A replaced document also kills this handle, should a read fall back before the event arrives.
    const documentHandle = await page.evaluateHandle(() => document);
    try {
      const read = await readSettled(target, page, options, isStillBusy, navigation.signal);
      if (navigation.signal.aborted) {
        throw new NavigatedError('observe: the page navigated while it was read');
      }
      await documentHandle.evaluate(() => undefined);
      return read;
    } finally {
      await documentHandle.dispose().catch(() => {});
    }
  } finally {
    page.off('framenavigated', onNavigated);
  }
};

/** Reads a settled page: its snapshot, then every control's link, field and cover at once. */
const readSettled = async (
  target: Page | Locator,
  page: Page,
  options: ObserveOptions | undefined,
  isStillBusy: boolean,
  signal: AbortSignal,
): Promise<PageRead> => {
  const isTargetLocator = isLocator(target);

  const rawSnapshot = await page.ariaSnapshotJSON({ mode: 'ai' });
  const parsedRoot = ariaSnapshotRootSchema.safeParse(rawSnapshot);
  // A snapshot of a shape this code doesn't know means a Playwright change: fail loudly.
  if (!parsedRoot.success) {
    throw new Error(
      `observe: unexpected aria snapshot from Playwright: ${parsedRoot.error.message}`,
    );
  }

  const redact = createRedactor(options?.values);
  const snapshotData = redactSnapshot(parsedRoot.data, redact);

  const { candidates: allCandidates, headings: allHeadings } = collectSnapshot(snapshotData);

  // A locator keeps the controls and headings inside it; their paths still name what is above it.
  const inside = isTargetLocator
    ? await refsInside(
        page,
        target,
        [
          ...allCandidates.map(candidate => candidate.node.ref),
          ...allHeadings.flatMap(heading => (heading.ref === undefined ? [] : [heading.ref])),
        ],
        signal,
      )
    : undefined;
  const candidates =
    inside === undefined
      ? allCandidates
      : allCandidates.filter(candidate => inside.has(candidate.node.ref));
  const headings = allHeadings
    .filter(
      heading => inside === undefined || (heading.ref !== undefined && inside.has(heading.ref)),
    )
    .map(({ level, text }) => ({ level, text }));

  const baseUrl = await page.evaluate(() => document.baseURI).catch(() => page.url());

  // Every control's link, field and cover are read at once: a page has hundreds of controls.
  const allCandidatesWithFields = await Promise.all(
    candidates.map(async (candidate): Promise<CandidateWithField> => {
      const { ref, role = '' } = candidate.node;
      const hasField = FILL_ROLES.has(role) || role === 'checkbox' || role === 'switch';
      const [url, field, isCoveredNow] = await Promise.all([
        candidate.rawUrl === undefined
          ? undefined
          : resolveHref(page, ref, candidate.rawUrl, baseUrl, signal),
        hasField ? readField(page, ref, signal) : undefined,
        isCovered(page, ref, signal),
      ]);
      return {
        candidate,
        ...(url !== undefined ? { url } : {}),
        ...(field !== undefined ? { field } : {}),
        isCovered: isCoveredNow,
      };
    }),
  );

  const rawText = await (isTargetLocator ? target : page.locator('body'))
    .innerText()
    .catch(() => '');

  const text = formatVisibleText(rawText, redact);
  const fields = buildFields(allCandidatesWithFields, redact);

  // A covered control is still read for `fields`, but it is not a move.
  const offeredCandidates = allCandidatesWithFields.filter(item => {
    if (item.isCovered) return false;
    if (options?.shouldOffer === undefined) return true;
    const { candidate, url } = item;
    const control: Control = {
      role: candidate.node.role ?? '',
      name: candidate.node.name,
      path: candidate.path,
      ...(url !== undefined ? { url } : {}),
    };
    return options.shouldOffer(control);
  });

  const context: PageContext = {
    url: redact(page.url()),
    title: redact(await page.title()),
    headings,
    text,
    fields,
    ...(isStillBusy ? { busy: true } : {}),
  };

  const ops = buildControlOps(page, offeredCandidates, options?.values, redact);
  const isEverythingCovered =
    allCandidatesWithFields.length > 0 && allCandidatesWithFields.every(item => item.isCovered);

  return { context, ops, isEverythingCovered };
};

export const observe = async (
  target: Page | Locator,
  options?: ObserveOptions,
): Promise<{ context: PageContext; ops: Ops }> => {
  const page: Page = isLocator(target) ? target.page() : target;
  const failedMove = takeFailedMove(page);

  const started = Date.now();
  const read = async (): Promise<PageRead> => {
    try {
      const pageRead = await readPage(target, page, options);
      // Every control covered is a page between states: a dialog open over it whose content is
      // still loading (GitHub's search fetches its suggestions once open), or a loading screen.
      if (!pageRead.isEverythingCovered || Date.now() > started + COVERED_DEADLINE_MS) {
        return pageRead;
      }
      await new Promise(resolve => setTimeout(resolve, COVERED_RETRY_MS));
      return read();
    } catch (error) {
      const isNavigation = error instanceof NavigatedError || isNavigationError(error);
      if (!isNavigation || Date.now() > started + NAVIGATION_DEADLINE_MS) throw error;
      return read();
    }
  };

  const { context, ops } = await read();
  return { context: { ...context, ...(failedMove !== undefined ? { failedMove } : {}) }, ops };
};
