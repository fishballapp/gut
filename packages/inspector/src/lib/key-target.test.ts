/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { isKeyBlocked, isPageKey } from './key-target.ts';

const el = (html: string): Element => {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const child = wrap.firstElementChild;
  if (child === null) throw new Error(`no element in ${html}`);
  return child;
};

/** A keydown dispatched on `target`; `isPrevented` makes the target prevent it, as a radio does for Enter. */
const keydown = (key: string, target: Element, isPrevented = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  if (isPrevented) target.addEventListener('keydown', handled => handled.preventDefault());
  target.dispatchEvent(event);
  return event;
};

describe('isKeyBlocked', () => {
  it('lets the page have its keys when nothing interactive has focus', () => {
    expect(isKeyBlocked(null)).toBe(false);
    expect(isKeyBlocked(el('<div>plain</div>'))).toBe(false);
  });

  it('keeps the keys of text fields and buttons', () => {
    expect(isKeyBlocked(el('<input type="text" />'))).toBe(true);
    expect(isKeyBlocked(el('<button type="button">Ask model</button>'))).toBe(true);
  });

  it("lets the page have the keys of the answer form's focused radio", () => {
    const radio = el('<div data-answer-form><span role="radio" aria-checked="true"></span></div>');
    expect(isKeyBlocked(radio.firstElementChild)).toBe(false);
  });

  it("keeps the keys of any other radio, such as the model picker's", () => {
    expect(isKeyBlocked(el('<span role="radio" aria-checked="true"></span>'))).toBe(true);
  });
});

describe('isPageKey', () => {
  const answerRadio = (): Element => {
    const radio = el(
      '<div data-answer-form><span role="radio" aria-checked="false"></span></div>',
    ).firstElementChild;
    if (radio === null) throw new Error('no radio');
    return radio;
  };

  it('takes an Enter that a focused radio prevented', () => {
    expect(isPageKey(keydown('Enter', answerRadio(), true))).toBe(true);
  });

  it('leaves Enter to a radio outside the answer form', () => {
    expect(isPageKey(keydown('Enter', el('<span role="radio"></span>'), true))).toBe(false);
  });

  it('leaves Enter to a text field or a button, prevented or not', () => {
    expect(isPageKey(keydown('Enter', el('<input type="text" />')))).toBe(false);
    expect(isPageKey(keydown('Enter', el('<button type="button">Answer</button>')))).toBe(false);
  });

  it('takes a digit a radio did not prevent, and leaves one it did', () => {
    expect(isPageKey(keydown('2', answerRadio()))).toBe(true);
    expect(isPageKey(keydown('2', answerRadio(), true))).toBe(false);
  });

  it('ignores modified keys', () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, cancelable: true });
    answerRadio().dispatchEvent(event);
    expect(isPageKey(event)).toBe(false);
  });
});
