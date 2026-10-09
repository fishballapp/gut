/**
 * Page context aggregation: fields with states, headings, and visible text.
 */

import { claim } from './keys.ts';
import type { CandidateWithField } from './ops.ts';
import { FILL_ROLES } from './paths.ts';
import type { AriaSnapshotNode } from './snapshot.ts';

export const MAX_VISIBLE_TEXT_CHARS = 4_000;

export type PageContext = {
  readonly url: string;
  readonly title: string;
  readonly headings: readonly { readonly level: number; readonly text: string }[];
  readonly text: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly busy?: true;
};

export const formatVisibleText = (raw: string, redact: (text: string) => string): string => {
  const collapsed = raw.replace(/\n[ \t\r]*\n+/g, '\n\n').trim();
  const redacted = redact(collapsed);
  if (redacted.length <= MAX_VISIBLE_TEXT_CHARS) return redacted;
  return `${redacted.slice(0, MAX_VISIBLE_TEXT_CHARS)}…`;
};

export const buildFields = (
  items: readonly CandidateWithField[],
  redact: (text: string) => string,
): Record<string, string> => {
  const fields: Record<string, string> = {};
  const usedFieldKeys = new Set<string>();

  for (const item of items) {
    const { candidate, field } = item;
    const { node, path } = candidate;
    const { role, name } = node;

    const pathParts = [...path, name].filter(p => p.length > 0);
    const fieldKeyBase = pathParts.join(' › ');

    if (role === 'checkbox' || role === 'switch') {
      const state = field?.checkedState ?? (node.checked === true ? 'checked' : 'unchecked');
      const fieldKey = claim(fieldKeyBase, usedFieldKeys, n => `${fieldKeyBase} (${n})`);
      fields[fieldKey] = state;
    } else if (role === 'combobox') {
      const selectedOption = node.children
        ?.filter((c): c is AriaSnapshotNode => typeof c !== 'string')
        .find(c => c.role === 'option' && c.selected);

      const chosen = field?.selectedLabel ?? selectedOption?.name;
      if (chosen !== undefined && chosen.trim().length > 0) {
        const fieldKey = claim(fieldKeyBase, usedFieldKeys, n => `${fieldKeyBase} (${n})`);
        fields[fieldKey] = redact(chosen.trim());
      }
    } else if (role !== undefined && FILL_ROLES.has(role) && field !== undefined) {
      if (!field.isPassword) {
        const fieldKey = claim(fieldKeyBase, usedFieldKeys, n => `${fieldKeyBase} (${n})`);
        fields[fieldKey] = redact(field.value);
      }
    }
  }

  return fields;
};
