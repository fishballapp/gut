/**
 * Aria snapshot schema, page settling, field reads, and href resolution.
 */

import type { Locator, Page } from 'playwright';
import { z } from 'zod';

export type AriaSnapshotNode = {
  readonly role?: string;
  readonly name?: string;
  readonly ref?: string;
  readonly level?: number;
  readonly text?: string;
  readonly url?: string;
  readonly disabled?: boolean;
  readonly checked?: boolean | 'mixed';
  readonly selected?: boolean;
  readonly expanded?: boolean;
  readonly children?: readonly (AriaSnapshotNode | string)[];
};

const ariaSnapshotNodeSchema: z.ZodType<AriaSnapshotNode> = z.lazy(() =>
  z.looseObject({
    role: z.string().optional(),
    name: z.string().optional(),
    ref: z.string().optional(),
    level: z.number().optional(),
    text: z.string().optional(),
    url: z.string().optional(),
    disabled: z.boolean().optional(),
    checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
    selected: z.boolean().optional(),
    expanded: z.boolean().optional(),
    children: z.array(z.union([ariaSnapshotNodeSchema, z.string()])).optional(),
  }),
);

export const ariaSnapshotRootSchema = z.array(ariaSnapshotNodeSchema);

export const redactSnapshot = (
  nodes: readonly AriaSnapshotNode[],
  redact: (text: string) => string,
): readonly AriaSnapshotNode[] => {
  const redactNode = (node: AriaSnapshotNode): AriaSnapshotNode => ({
    ...node,
    ...(node.name !== undefined ? { name: redact(node.name) } : {}),
    ...(node.text !== undefined ? { text: redact(node.text) } : {}),
    ...(node.children !== undefined
      ? {
          children: node.children.map(child =>
            typeof child === 'string' ? redact(child) : redactNode(child),
          ),
        }
      : {}),
  });

  return nodes.map(redactNode);
};

/** A read that met a navigation: the document it read is gone, and the new one is loading. */
export const isNavigationError = (error: unknown): boolean =>
  error instanceof Error &&
  /Execution context was destroyed|navigation|Frame was detached/i.test(error.message);

export const waitForDomQuiet = async (page: Page): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await page.waitForLoadState('domcontentloaded');
      await page.evaluate(
        ({ quietMs, timeoutMs }) =>
          new Promise<void>((resolve, reject) => {
            // A document with no root yet is mid-navigation: retried as one.
            if (document.documentElement === null) {
              reject(new Error('navigation: documentElement is not yet available'));
              return;
            }
            const observer = new MutationObserver(() => {
              clearTimeout(quiet);
              quiet = setTimeout(done, quietMs);
            });
            const done = () => {
              observer.disconnect();
              clearTimeout(quiet);
              clearTimeout(timeout);
              resolve();
            };
            let quiet = setTimeout(done, quietMs);
            const timeout = setTimeout(done, timeoutMs);
            observer.observe(document.documentElement, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true,
            });
          }),
        { quietMs: 100, timeoutMs: 2_000 },
      );
      return;
    } catch (error) {
      if (!isNavigationError(error) || Date.now() > deadline) throw error;
    }
  }
};

export const waitForAriaBusyQuiet = async (page: Page): Promise<boolean> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await page.locator('[aria-busy="true"]').count()) === 0) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return true;
};

/** A native `<select>`'s option as the DOM has it: `index` counts hidden options too. */
export type DomSelectOption = {
  readonly label: string;
  readonly index: number;
  readonly isDisabled: boolean;
  readonly isHidden: boolean;
};

export type FieldRead = {
  readonly isPassword: boolean;
  readonly value: string;
  readonly isEditable: boolean;
  readonly selectedLabel?: string;
  readonly checkedState?: 'checked' | 'unchecked' | 'mixed';
  readonly selectOptions?: readonly DomSelectOption[];
};

/**
 * Whether a click on the control would land on something else: it is hidden, outside every open
 * modal dialog (which makes the rest of the page inert), or each of its boxes in the viewport
 * hit-tests to an element outside it and its labels (an overlay, a backdrop). A wrapped link has a
 * box per line, so each is tried. A control with no box in the viewport can't be hit-tested, and a
 * click scrolls to it first, so it is otherwise uncovered.
 */
export const isCovered = (page: Page, ref: string, signal: AbortSignal): Promise<boolean> =>
  page
    .locator(`aria-ref=${ref}`)
    .evaluate(
      element => {
        // Up from `node`, through shadow roots to their hosts.
        const isInside = (container: Element, node: Element | null): boolean => {
          let current = node;
          while (current !== null) {
            if (current === container) return true;
            const root = current.getRootNode();
            current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
          }
          return false;
        };
        const isShown = (node: Element) => node.checkVisibility({ visibilityProperty: true });

        // No box of its own: its children are what a click lands on.
        if (getComputedStyle(element).display === 'contents') return false;
        if (!isShown(element)) return true;

        const modals = Array.from(document.querySelectorAll('[aria-modal="true"], :modal')).filter(
          isShown,
        );
        if (modals.length > 0 && !modals.some(modal => isInside(modal, element))) return true;

        const root = element.getRootNode();
        if (!(root instanceof Document || root instanceof ShadowRoot)) return false;
        const centres = Array.from(element.getClientRects())
          .map(rect => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }))
          .filter(
            ({ x, y }) => x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight,
          );
        if (centres.length === 0) return false;

        // A styled checkbox is often hidden under its label, which takes the click for it.
        const targets = [
          element,
          ...('labels' in element && element.labels instanceof NodeList ? element.labels : []),
          element.closest('label'),
        ].filter(target => target instanceof Element);
        return !centres.some(({ x, y }) => {
          const hit = root.elementFromPoint(x, y);
          return targets.some(target => isInside(target, hit));
        });
      },
      undefined,
      { signal },
    )
    // A control that can't be read (detached since the snapshot) is not offered.
    .catch(() => true);

export const readField = async (
  page: Page,
  ref: string,
  signal: AbortSignal,
): Promise<FieldRead> => {
  try {
    return await page.locator(`aria-ref=${ref}`).evaluate(
      element => {
        let isPassword = false;
        let value = '';
        let isEditable = false;
        let selectedLabel: string | undefined;
        let checkedState: 'checked' | 'unchecked' | 'mixed' | undefined;
        let selectOptions: DomSelectOption[] | undefined;

        if (element instanceof HTMLInputElement) {
          isPassword = element.type === 'password';
          value = element.value;
          const nonEditableTypes = new Set([
            'checkbox',
            'radio',
            'button',
            'submit',
            'reset',
            'image',
          ]);
          isEditable =
            !nonEditableTypes.has(element.type.toLowerCase()) &&
            !element.readOnly &&
            !element.disabled;
          if (element.type === 'checkbox' || element.type === 'radio') {
            if (element.indeterminate) {
              checkedState = 'mixed';
            } else if (element.checked) {
              checkedState = 'checked';
            } else {
              checkedState = 'unchecked';
            }
          }
        } else if (element instanceof HTMLTextAreaElement) {
          value = element.value;
          isEditable = !element.readOnly && !element.disabled;
        } else if (element instanceof HTMLSelectElement) {
          const selectedOption = element.options[element.selectedIndex];
          selectedLabel = selectedOption?.label ?? selectedOption?.text;
          const isHidden = (node: HTMLElement) =>
            node.hidden !== false || getComputedStyle(node).display === 'none';
          selectOptions = Array.from(element.options).map((option, index) => {
            const group =
              option.parentElement instanceof HTMLOptGroupElement ? option.parentElement : null;
            return {
              label: (option.label || option.text).trim(),
              index,
              isDisabled: option.disabled || group?.disabled === true,
              isHidden: isHidden(option) || (group !== null && isHidden(group)),
            };
          });
        } else {
          const isContentEditable = element instanceof HTMLElement && element.isContentEditable;
          const ariaReadonly = element.getAttribute('aria-readonly') === 'true';
          const ariaDisabled = element.getAttribute('aria-disabled') === 'true';
          isEditable = isContentEditable && !ariaReadonly && !ariaDisabled;
          if (element instanceof HTMLElement && element.isContentEditable) {
            value = element.innerText;
          } else {
            value = element.textContent ?? '';
          }
          const ariaChecked = element.getAttribute('aria-checked');
          if (ariaChecked === 'true') {
            checkedState = 'checked';
          } else if (ariaChecked === 'mixed') {
            checkedState = 'mixed';
          } else if (ariaChecked === 'false') {
            checkedState = 'unchecked';
          }
        }

        return {
          isPassword,
          value,
          isEditable,
          selectedLabel,
          checkedState,
          ...(selectOptions !== undefined ? { selectOptions } : {}),
        };
      },
      undefined,
      { signal },
    );
  } catch {
    return { isPassword: true, value: '', isEditable: false };
  }
};

export const resolveHref = async (
  page: Page,
  ref: string,
  href: string,
  baseUrl: string,
  signal: AbortSignal,
): Promise<string | undefined> => {
  if (URL.canParse(href, baseUrl)) {
    return new URL(href, baseUrl).href;
  }
  try {
    const evaluated = await page
      .locator(`aria-ref=${ref}`)
      .evaluate(
        element => (element instanceof HTMLAnchorElement ? element.href : undefined),
        undefined,
        { signal },
      );
    return evaluated ?? href;
  } catch {
    return href;
  }
};

/**
 * Which of `refs` are inside `target`, checked at once: the target is tagged for the duration, so a
 * role-less container (a plain `<div>`, absent from the aria tree) scopes as well as a landmark.
 */
export const refsInside = async (
  page: Page,
  target: Locator,
  refs: readonly string[],
  signal: AbortSignal,
): Promise<ReadonlySet<string>> => {
  const tag = `data-gut-scope-${crypto.randomUUID()}`;
  await target.evaluate((element, attribute) => element.setAttribute(attribute, ''), tag);
  try {
    const isInside = await Promise.all(
      refs.map(ref =>
        page
          .locator(`aria-ref=${ref}`)
          .evaluate(
            (element, attribute) => {
              let node: Node | null = element;
              while (node !== null) {
                if (node instanceof Element && node.hasAttribute(attribute)) {
                  return true;
                }
                const root = node.getRootNode();
                node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
              }
              return false;
            },
            tag,
            { signal },
          )
          .catch(() => false),
      ),
    );
    return new Set(refs.filter((_, i) => isInside[i]));
  } finally {
    // A page that moved on took the tag with it.
    await target
      .evaluate((element, attribute) => element.removeAttribute(attribute), tag)
      .catch(() => {});
  }
};
