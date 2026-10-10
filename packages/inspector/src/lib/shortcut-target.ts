/** Elements that own Space / letter / arrow keys; the page shortcuts must not steal from them. */
const INTERACTIVE =
  'button, a, input, textarea, select, summary, [contenteditable], [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/** True when a keydown should stay with the focused control (or a text field). */
export const isShortcutBlockedTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest(INTERACTIVE) !== null;
};
