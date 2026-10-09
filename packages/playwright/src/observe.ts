/**
 * Orchestration of DOM settling, snapshot parsing, scoping, and observe().
 */

import type { Ops } from '@gut.run/core';
import type { Locator, Page } from 'playwright';
import { buildFields, formatVisibleText, type PageContext } from './context.ts';
import { buildControlOps, type CandidateWithField } from './ops.ts';
import { type Control, collectSnapshot, FILL_ROLES } from './paths.ts';
import { createRedactor, type Secret } from './secret.ts';
import {
  ariaSnapshotRootSchema,
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

export const observe = async (
  target: Page | Locator,
  options?: ObserveOptions,
): Promise<{ context: PageContext; ops: Ops }> => {
  const isTargetLocator = isLocator(target);
  const page: Page = isTargetLocator ? target.page() : target;

  if (isTargetLocator) {
    const count = await target.count();
    if (count === 0) {
      throw new Error('observe: locator matched 0 elements; expected exactly 1');
    }
    if (count > 1) {
      throw new Error(`observe: locator matched ${count} elements; expected exactly 1`);
    }
  }

  await waitForDomQuiet(page);
  const isStillBusy = await waitForAriaBusyQuiet(page);

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
    ? await refsInside(page, target, [
        ...allCandidates.map(candidate => candidate.node.ref),
        ...allHeadings.flatMap(heading => (heading.ref === undefined ? [] : [heading.ref])),
      ])
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

  // Every control's link and field are read at once: a page has hundreds of controls.
  const allCandidatesWithFields = await Promise.all(
    candidates.map(async (candidate): Promise<CandidateWithField> => {
      const role = candidate.node.role ?? '';
      const resolvedUrl =
        candidate.rawUrl !== undefined
          ? await resolveHref(page, candidate.node.ref, candidate.rawUrl, baseUrl)
          : undefined;
      const hasField = FILL_ROLES.has(role) || role === 'checkbox' || role === 'switch';
      return {
        candidate,
        ...(resolvedUrl !== undefined ? { url: resolvedUrl } : {}),
        ...(hasField ? { field: await readField(page, candidate.node.ref) } : {}),
      };
    }),
  );

  const rawText = isTargetLocator
    ? await target.innerText().catch(() => '')
    : await page
        .locator('body')
        .innerText()
        .catch(() => '');

  const text = formatVisibleText(rawText, redact);
  const fields = buildFields(allCandidatesWithFields, redact);

  const offeredCandidates = allCandidatesWithFields.filter(item => {
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

  return { context, ops };
};
