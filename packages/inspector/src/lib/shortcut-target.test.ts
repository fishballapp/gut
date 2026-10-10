/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { isShortcutBlockedTarget } from './shortcut-target.ts';

const el = (html: string): Element => {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const child = wrap.firstElementChild;
  if (child === null) throw new Error(`no element in ${html}`);
  return child;
};

describe('isShortcutBlockedTarget', () => {
  it('allows the page when the target is not interactive', () => {
    expect(isShortcutBlockedTarget(null)).toBe(false);
    expect(isShortcutBlockedTarget(el('<div>plain</div>'))).toBe(false);
    expect(isShortcutBlockedTarget(el('<span class="pill">Paused</span>'))).toBe(false);
  });

  it('blocks typing fields and contenteditable', () => {
    expect(isShortcutBlockedTarget(el('<input />'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<select><option /></select>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<div contenteditable="true">edit</div>'))).toBe(true);
  });

  it('blocks buttons, links, summary, and common widget roles', () => {
    expect(isShortcutBlockedTarget(el('<button type="button">Play</button>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<a href="#">Docs</a>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<summary>fold</summary>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<div role="button">x</div>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<div role="checkbox"></div>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<div role="radio"></div>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<div role="switch"></div>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<div role="tab">Tab</div>'))).toBe(true);
  });

  it('blocks the keys of an open menu, so its arrows stay in the menu', () => {
    expect(isShortcutBlockedTarget(el('<div role="menu"></div>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<div role="menuitem">Count</div>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<div role="menuitemradio">Count</div>'))).toBe(true);
    expect(isShortcutBlockedTarget(el('<div role="menuitemcheckbox">Count</div>'))).toBe(true);
  });

  it('blocks a nested target inside an interactive ancestor', () => {
    const button = el('<button type="button"><kbd>Space</kbd></button>');
    const kbd = button.querySelector('kbd');
    if (kbd === null) throw new Error('no kbd');
    expect(isShortcutBlockedTarget(kbd)).toBe(true);
  });
});
