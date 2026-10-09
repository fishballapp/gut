/**
 * Op construction, role-to-verb mapping, element interaction via actOn, and tree building.
 */

import { group, type Op, type Ops, op } from '@gut.run/core';
import type { Locator, Page } from 'playwright';
import { claim, sanitizeKeyPart } from './keys.ts';
import type { RawCandidate, SelectOption } from './paths.ts';
import { isSecret, readSecret, redactError, type Secret } from './secret.ts';
import type { FieldRead } from './snapshot.ts';

export type CandidateWithField = {
  readonly candidate: RawCandidate;
  /** A link's absolute URL, resolved as the browser would. */
  readonly url?: string;
  readonly field?: FieldRead;
};

/** How long an action waits for its element before the op throws. */
const ACT_TIMEOUT_MS = 5_000;

export const actOn = async <T>(
  page: Page,
  ref: string,
  action: (locator: Locator) => Promise<T>,
  redact: (text: string) => string,
): Promise<T> => {
  try {
    const loc = page.locator(`aria-ref=${ref}`);
    if ((await loc.count()) === 0) {
      throw new Error(`Element with aria-ref=${ref} is stale (no longer attached)`);
    }
    // ponytail: a bound element handle would remove the detachment race between count and action if stalls show up.
    return await action(loc);
  } catch (error) {
    throw redactError(error, redact);
  }
};

export type OpEntry = {
  readonly path: readonly string[];
  readonly key: string;
  readonly op: Op;
};

export const buildOps = (entries: readonly OpEntry[]): Ops => {
  type Item =
    | { readonly kind: 'leaf'; readonly key: string; readonly op: Op }
    | { readonly kind: 'group'; readonly name: string; readonly children: OpEntry[] };

  const items: Item[] = [];
  const groupByName = new Map<
    string,
    { readonly kind: 'group'; readonly name: string; readonly children: OpEntry[] }
  >();

  for (const entry of entries) {
    if (entry.path.length === 0) {
      items.push({ kind: 'leaf', key: entry.key, op: entry.op });
    } else {
      const [head, ...rest] = entry.path;
      if (head !== undefined) {
        let groupItem = groupByName.get(head);
        if (groupItem === undefined) {
          groupItem = { kind: 'group', name: head, children: [] };
          groupByName.set(head, groupItem);
          items.push(groupItem);
        }
        groupItem.children.push({ path: rest, key: entry.key, op: entry.op });
      }
    }
  }

  const result: Record<string, Op> = {};
  const usedKeys = new Set<string>();

  for (const item of items) {
    if (item.kind === 'leaf') {
      const uniqueKey = claim(item.key, usedKeys);
      result[uniqueKey] = item.op;
    } else {
      const childOps = buildOps(item.children);
      if (Object.keys(childOps).length > 0) {
        const baseKey = `group_${sanitizeKeyPart(item.name)}`;
        const uniqueKey = claim(baseKey, usedKeys);
        result[uniqueKey] = group(item.name, childOps);
      }
    }
  }

  return result;
};

type RoleActionSpec = {
  readonly verb: string;
  readonly keyPrefix: string;
};

const ROLE_ACTIONS: Readonly<Record<string, RoleActionSpec>> = {
  link: { verb: 'Open link', keyPrefix: 'open_link' },
  button: { verb: 'Click', keyPrefix: 'click' },
  radio: { verb: 'Choose', keyPrefix: 'choose' },
  tab: { verb: 'Choose', keyPrefix: 'choose' },
  menuitem: { verb: 'Choose', keyPrefix: 'choose' },
  option: { verb: 'Choose', keyPrefix: 'choose' },
};

const checkActionSpec = (isChecked: boolean): RoleActionSpec =>
  isChecked ? { verb: 'Uncheck', keyPrefix: 'uncheck' } : { verb: 'Check', keyPrefix: 'check' };

export const buildControlEntries = (
  item: CandidateWithField,
  page: Page,
  values: Readonly<Record<string, string | Secret>> | undefined,
  redact: (text: string) => string,
): readonly OpEntry[] => {
  const { candidate, field } = item;
  const { node, path } = candidate;
  const { role, name, ref } = node;
  const entries: OpEntry[] = [];

  if (role === 'checkbox' || role === 'switch') {
    const isChecked =
      field?.checkedState === 'checked' ||
      (field?.checkedState === undefined && node.checked === true);
    const spec = checkActionSpec(isChecked);
    const description = `${spec.verb} "${name}"`;
    const key = `${spec.keyPrefix}_${sanitizeKeyPart(name)}`;
    entries.push({
      path,
      key,
      op: op(description, () =>
        actOn(page, ref, loc => loc.click({ timeout: ACT_TIMEOUT_MS }), redact),
      ),
    });
  } else if (role !== undefined && role in ROLE_ACTIONS) {
    const spec = ROLE_ACTIONS[role];
    if (spec !== undefined) {
      const description = `${spec.verb} "${name}"`;
      const key = `${spec.keyPrefix}_${sanitizeKeyPart(name)}`;
      entries.push({
        path,
        key,
        op: op(description, () =>
          actOn(page, ref, loc => loc.click({ timeout: ACT_TIMEOUT_MS }), redact),
        ),
      });
    }
  }

  const selectOptions = (() => {
    if (field?.selectOptions !== undefined) {
      return field.selectOptions
        .filter(option => !option.isHidden && !option.isDisabled && option.label.length > 0)
        .map(option => ({ name: option.label, index: option.index }));
    }
    return candidate.comboboxOptions;
  })();

  const hasSelectOp = selectOptions !== undefined && selectOptions.length > 0;
  if (role === 'combobox' && hasSelectOp) {
    const description = `Select in "${name}"`;
    const key = `select_${sanitizeKeyPart(name)}`;

    const choices: Record<string, SelectOption> = {};
    const usedLabels = new Set<string>();
    for (const option of selectOptions) {
      const redacted = redact(option.name);
      const label = claim(redacted, usedLabels, n => `${redacted} (${n})`);
      choices[label] = option;
    }

    entries.push({
      path,
      key,
      op: op(description, {
        choices,
        invoke: async (option: SelectOption) => {
          if (option.ref !== undefined) {
            await actOn(page, option.ref, loc => loc.click({ timeout: ACT_TIMEOUT_MS }), redact);
          } else {
            // ponytail: an option the page adds or removes before the pick shifts this index to a
            // neighbour; the next tick shows the field's value. Bind the option element if seen.
            await actOn(
              page,
              ref,
              loc => loc.selectOption({ index: option.index }, { timeout: ACT_TIMEOUT_MS }),
              redact,
            );
          }
        },
      }),
    });
  }

  const isFillRole =
    (role === 'textbox' || role === 'searchbox' || role === 'spinbutton' || role === 'combobox') &&
    field?.isEditable === true;

  if (isFillRole && values !== undefined) {
    const isPassword = field.isPassword;
    const isSpinbutton = role === 'spinbutton';

    const choices: Record<string, string> = {};
    const usedLabels = new Set<string>();

    for (const [what, val] of Object.entries(values)) {
      if (isPassword) {
        // A filled password is compared here, never shown: without this, a field that already
        // holds it is offered it again, and the model refills it instead of moving on.
        if (isSecret(val) && field.value !== readSecret(val)) {
          const redactedLabel = redact(what);
          const label = claim(redactedLabel, usedLabels, n => `${redactedLabel} (${n})`);
          choices[label] = readSecret(val);
        }
      } else if (typeof val === 'string') {
        if (isSpinbutton && !/^-?\d+(\.\d+)?$/.test(val.trim())) {
          continue;
        }
        if (field.value === val) {
          continue;
        }
        const rawLabel = `${what}: ${val}`;
        const redactedLabel = redact(rawLabel);
        const label = claim(redactedLabel, usedLabels, n => `${redactedLabel} (${n})`);
        choices[label] = val;
      }
    }

    if (Object.keys(choices).length > 0) {
      const description = `Fill "${name}"`;
      const key = `fill_${sanitizeKeyPart(name)}`;
      entries.push({
        path,
        key,
        op: op(description, {
          choices,
          invoke: async (value: string) => {
            await actOn(page, ref, loc => loc.fill(value, { timeout: ACT_TIMEOUT_MS }), redact);
          },
        }),
      });
    }
  }

  // A closed custom dropdown: its options are on the page only once it opens. A native select, an
  // editable field or an open one is offered what it already shows.
  const isClosedCustomDropdown =
    role === 'combobox' &&
    field?.selectOptions === undefined &&
    field?.isEditable !== true &&
    node.expanded !== true;
  if (isClosedCustomDropdown && !hasSelectOp) {
    const description = `Open "${name}"`;
    const key = `open_${sanitizeKeyPart(name)}`;
    entries.push({
      path,
      key,
      op: op(description, () =>
        actOn(page, ref, loc => loc.click({ timeout: ACT_TIMEOUT_MS }), redact),
      ),
    });
  }

  return entries;
};

export const buildControlOps = (
  page: Page,
  items: readonly CandidateWithField[],
  values: Readonly<Record<string, string | Secret>> | undefined,
  redact: (text: string) => string,
): Ops => {
  const entries = items.flatMap(item => buildControlEntries(item, page, values, redact));
  return buildOps(entries);
};
