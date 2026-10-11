import type { ModelInfo } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import { draftForMove, maxOptionsSlider, shownSize, sizeToSend } from './max-options.ts';

const clef: ModelInfo = { name: 'clef', endpoint: 'http://localhost:11434', maxOptions: 26 };

describe('maxOptionsSlider', () => {
  it("follows the model until a size is chosen, up to the model's limit", () => {
    expect(maxOptionsSlider({ chosen: null, model: clef })).toEqual({
      min: 2,
      max: 26,
      value: 26,
    });
    expect(maxOptionsSlider({ chosen: 12, model: clef })).toEqual({ min: 2, max: 26, value: 12 });
    expect(maxOptionsSlider({ chosen: 200, model: clef })).toEqual({ min: 2, max: 26, value: 26 });
  });

  it("ranges to the largest default question with no model, and shows a person's size", () => {
    expect(maxOptionsSlider({ chosen: null, model: null })).toEqual({
      min: 2,
      max: 255,
      value: 26,
    });
    expect(maxOptionsSlider({ chosen: 40, model: null })).toEqual({ min: 2, max: 255, value: 40 });
  });

  it('follows a smaller model when the model changes', () => {
    expect(maxOptionsSlider({ chosen: 40, model: { ...clef, maxOptions: 30 } }).value).toBe(30);
    expect(maxOptionsSlider({ chosen: 40, model: { ...clef, maxOptions: 255 } }).value).toBe(40);
  });
});

describe('the slider draft', () => {
  it('shows the session size until the developer moves it', () => {
    expect(shownSize(undefined, 26)).toBe(26);
    expect(shownSize({ value: 12, isSending: false }, 26)).toBe(12);
  });

  it('makes no draft for a move onto the session size', () => {
    expect(draftForMove(26, 26)).toBeUndefined();
    expect(draftForMove(12, 26)).toEqual({ value: 12, isSending: false });
  });

  it('sends a move not yet on its way, and never a draft that is already sending', () => {
    expect(sizeToSend({ value: 12, isSending: false })).toBe(12);
    expect(sizeToSend({ value: 12, isSending: true })).toBeUndefined();
    expect(sizeToSend(undefined)).toBeUndefined();
  });
});
