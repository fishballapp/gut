import { isShortcutBlockedTarget } from './shortcut-target.ts';

/** A radio of the answer form (`AnswerForm` carries `data-answer-form`); any other radio keeps its keys. */
const ANSWER_RADIO = '[data-answer-form] [role="radio"]';

const isRadioTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(ANSWER_RADIO) !== null;

/**
 * Whether a letter or digit keydown stays with its target. An answer form's radio takes arrows, not
 * letters or digits, so the page's answer keys still reach it; text fields, other controls and other
 * radios (the model picker's, in a dialog) keep theirs.
 */
export const isKeyBlocked = (target: EventTarget | null): boolean => {
  if (!isShortcutBlockedTarget(target)) return false;
  return !isRadioTarget(target);
};

/**
 * Whether the page takes a keydown. A control that already handled it keeps it, except Enter on a
 * answer form's radio: a radio prevents Enter itself, but the answer form answers on it.
 */
export const isPageKey = (event: KeyboardEvent): boolean => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return false;
  if (isKeyBlocked(event.target)) return false;
  if (event.key === 'Enter' && isRadioTarget(event.target)) return true;
  return !event.defaultPrevented;
};
