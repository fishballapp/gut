import { errors } from 'playwright';
import { describe, expect, it } from 'vitest';
import { formatActionError, StaleElementError } from './ops.ts';

describe('formatActionError', () => {
  it('formats StaleElementError as element is no longer on the page', () => {
    const error = new StaleElementError('Element with aria-ref=c1 is stale (no longer attached)');
    expect(formatActionError(error)).toBe('the element is no longer on the page');
  });

  it('extracts covering element when pointer events are intercepted', () => {
    const error = new errors.TimeoutError(
      `locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('aria-ref=c1')
    - locator resolved to <button>Submit</button>
  - attempting click action
    - <div class="overlay">Cover</div> intercepts pointer events
  - retrying click action`,
    );
    expect(formatActionError(error)).toBe('the control is covered by <div class="overlay">');
  });

  it('extracts tag with id, class, and role attributes', () => {
    const error = new errors.TimeoutError(
      `locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('aria-ref=c1')
  - attempting click action
    - <div id="modal" class="backdrop fade" role="dialog" style="display:block">...</div> intercepts pointer events`,
    );
    expect(formatActionError(error)).toBe(
      'the control is covered by <div id="modal" class="backdrop fade" role="dialog">',
    );
  });

  it('falls back to "another element" if no tag is found in intercepts line', () => {
    const error = new errors.TimeoutError(
      `locator.click: Timeout 5000ms exceeded.
Call log:
  - intercepts pointer events`,
    );
    expect(formatActionError(error)).toBe('the control is covered by another element');
  });

  it('reports a click whose page is slow to load, as arXiv logged it', () => {
    const error = new errors.TimeoutError(
      `locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('aria-ref=f2e74')
    - locator resolved to <a href="/search/cs?searchtype=author">Muhammad Jawad Chowdhury</a>
  - attempting click action
    - performing click action
    - click action done
    - waiting for scheduled navigations to finish`,
    );
    expect(formatActionError(error)).toBe('the page took too long to load after the click');
  });

  it('reports element is not visible', () => {
    const error = new errors.TimeoutError(
      `locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('aria-ref=c1')
    - element is not visible - waiting...`,
    );
    expect(formatActionError(error)).toBe('the element is not visible');
  });

  it('reports element is not enabled', () => {
    const error = new errors.TimeoutError(
      `locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('aria-ref=c1')
    - element is not enabled - waiting...`,
    );
    expect(formatActionError(error)).toBe('the element is not enabled');
  });

  it('reports element is not stable', () => {
    const error = new errors.TimeoutError(
      `locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('aria-ref=c1')
    - element is not stable - waiting...`,
    );
    expect(formatActionError(error)).toBe('the element is not stable');
  });

  it('reports element is not editable', () => {
    const error = new errors.TimeoutError(
      `locator.fill: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('aria-ref=c1')
    - element is not editable - waiting...`,
    );
    expect(formatActionError(error)).toBe('the element is not editable');
  });

  it('falls back to "the action timed out" on general timeout', () => {
    const error = new errors.TimeoutError('locator.click: Timeout 5000ms exceeded.');
    expect(formatActionError(error)).toBe('the action timed out');
  });
});
