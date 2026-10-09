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

const isNavigationError = (error: unknown): boolean =>
  error instanceof Error && /Execution context was destroyed|navigation/i.test(error.message);

export const waitForDomQuiet = async (page: Page): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await page.waitForLoadState('domcontentloaded');
      await page.evaluate(
        ({ quietMs, timeoutMs }) =>
          new Promise<void>(resolve => {
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

export const readField = async (page: Page, ref: string): Promise<FieldRead> => {
  try {
    return await page.locator(`aria-ref=${ref}`).evaluate(element => {
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
    });
  } catch {
    return { isPassword: true, value: '', isEditable: false };
  }
};

export const resolveHref = async (
  page: Page,
  ref: string,
  href: string,
  baseUrl: string,
): Promise<string | undefined> => {
  if (URL.canParse(href, baseUrl)) {
    return new URL(href, baseUrl).href;
  }
  try {
    const evaluated = await page
      .locator(`aria-ref=${ref}`)
      .evaluate(element => (element instanceof HTMLAnchorElement ? element.href : undefined));
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
): Promise<ReadonlySet<string>> => {
  const tag = `data-gut-scope-${crypto.randomUUID()}`;
  await target.evaluate((element, attribute) => element.setAttribute(attribute, ''), tag);
  try {
    const isInside = await Promise.all(
      refs.map(ref =>
        page
          .locator(`aria-ref=${ref}`)
          .evaluate((element, attribute) => {
            let node: Node | null = element;
            while (node !== null) {
              if (node instanceof Element && node.hasAttribute(attribute)) {
                return true;
              }
              const root = node.getRootNode();
              node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
            }
            return false;
          }, tag)
          .catch(() => false),
      ),
    );
    return new Set(refs.filter((_, i) => isInside[i]));
  } finally {
    await target.evaluate((element, attribute) => element.removeAttribute(attribute), tag);
  }
};
