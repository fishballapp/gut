import { type CDPSession, expect, type Page, test } from '@playwright/test';

// The story deck under real scroll gestures. `Input.synthesizeScrollGesture` makes a trackpad's as
// Chrome does: once the first wheel event of a swipe goes uncancelled, the rest of it, inertia and
// all, cannot be cancelled, as on a Mac. A finger's fling is raw touch events, which Chrome turns
// into a scroll and its inertia on every platform (a synthesized touch gesture scrolls nothing in
// Chrome on Linux, where CI runs). A scroll that reaches the stage
// must stop it at the top of the screen, and never carry it past and back: so every frame, the
// stage's top is sampled, and must move one way only and never pass 0. (The page's scrollY may
// pass the stage's start: the stage sticks over a runway, and the deck moves the scroll back
// within it unseen. What the reader sees is the stage.)

type Frame = { top: number; scrollY: number };

const record = (page: Page) =>
  page.evaluate(() => {
    const stage = document.querySelector('[data-stage]');
    if (stage === null) throw new Error('the page has no story stage');
    const frames: { top: number; scrollY: number }[] = [];
    const sample = () => {
      frames.push({ top: stage.getBoundingClientRect().top, scrollY });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    Object.assign(window, { __frames: frames });
  });

const framesOf = async (page: Page): Promise<Frame[]> =>
  page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames.splice(0));

/** Waits until the page has not scrolled for half a second. */
const settle = async (page: Page) => {
  await expect
    .poll(
      async () => {
        const before = await page.evaluate(() => scrollY);
        await page.waitForTimeout(500);
        return (await page.evaluate(() => scrollY)) === before;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
};

const slideOf = (page: Page) => page.locator('[data-stage]').getAttribute('data-slide');

/** A trackpad swipe's scroll: negative `yDistance` scrolls the page down. */
const gesture = (
  cdp: CDPSession,
  { yDistance, speed = 1600 }: { yDistance: number; speed?: number },
) =>
  cdp.send('Input.synthesizeScrollGesture', {
    x: 200,
    y: 400,
    yDistance,
    speed,
    gestureSourceType: 'mouse',
  });

/** A finger dragged quickly up the screen from `fromY` to `toY` and let go, so the page flings on. */
const fling = async (cdp: CDPSession, { fromY, toY }: { fromY: number; toY: number }) => {
  const touchAt = (y: number) => ({ touchPoints: [{ x: 200, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', ...touchAt(fromY) });
  for (let y = fromY - 50; y >= toY; y -= 50) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', ...touchAt(y) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

/** The stage's top moves one way only, from where it starts to 0, and never passes 0. */
const expectToReachTopWithoutPassing = (frames: Frame[], from: 'above' | 'below') => {
  const tops = frames.map(({ top }) => top);
  const direction = from === 'below' ? 1 : -1;
  const backtracks = tops.flatMap((top, index) => {
    const previous = tops[index - 1];
    return previous !== undefined && (top - previous) * direction < -0.5
      ? [{ index, previous, top }]
      : [];
  });
  expect(backtracks, 'the stage moved back the way it came').toEqual([]);
  const passed = from === 'below' ? Math.max(...tops) : -Math.min(...tops);
  expect(passed, 'the stage passed the top of the screen').toBeLessThanOrEqual(0.5);
  expect(Math.abs(tops.at(-1) ?? Number.NaN)).toBeLessThanOrEqual(0.5);
};

const runwayOf = (page: Page) =>
  page.evaluate(() => {
    const story = document.querySelector<HTMLElement>('[data-story]');
    const stage = document.querySelector<HTMLElement>('[data-stage]');
    if (story === null || stage === null) throw new Error('the page has no story');
    const start = scrollY + story.getBoundingClientRect().top;
    return { start, end: start + story.offsetHeight - stage.offsetHeight };
  });

const open = async (page: Page) => {
  // No consent banner over the stage.
  await page.addInitScript(() => localStorage.setItem('fishball.cookie-consent', 'denied'));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  return page.context().newCDPSession(page);
};

test.describe('entering the deck', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a trackpad swipe from the hero stops the stage at the top', async ({ page }) => {
    const cdp = await open(page);
    await record(page);
    await gesture(cdp, { yDistance: -1600 });
    await settle(page);
    expectToReachTopWithoutPassing(await framesOf(page), 'above');
    expect(await slideOf(page)).toBe('imagine');
  });

  test('a hard fling from the hero stops the stage at the top', async ({ page }) => {
    const cdp = await open(page);
    await record(page);
    await gesture(cdp, { yDistance: -5000, speed: 6000 });
    await settle(page);
    expectToReachTopWithoutPassing(await framesOf(page), 'above');
    expect(await slideOf(page)).toBe('imagine');
  });

  test('a wheel notch just above the stage stops it at the top', async ({ page }) => {
    const cdp = await open(page);
    const { start } = await runwayOf(page);
    await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), start - 60);
    await record(page);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 200,
      y: 400,
      deltaX: 0,
      deltaY: 100,
    });
    await settle(page);
    expectToReachTopWithoutPassing(await framesOf(page), 'above');
  });

  test('a swipe up from below stops the stage at the top, on the last slide', async ({ page }) => {
    const cdp = await open(page);
    const { end } = await runwayOf(page);
    await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), end + 700);
    await settle(page);
    await record(page);
    await gesture(cdp, { yDistance: 1800 });
    await settle(page);
    expectToReachTopWithoutPassing(await framesOf(page), 'below');
    expect(await slideOf(page)).toBe('run');
  });
});

test.describe('inside the deck', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('one swipe moves one slide, and the stage stays put', async ({ page }) => {
    const cdp = await open(page);
    await gesture(cdp, { yDistance: -1600 });
    await settle(page);
    await page.waitForTimeout(700);
    await record(page);
    await gesture(cdp, { yDistance: -900, speed: 3000 });
    await settle(page);
    expect((await framesOf(page)).every(({ top }) => Math.abs(top) <= 0.5)).toBe(true);
    expect(await slideOf(page)).toBe('race');
  });

  test('past the last slide, the next swipe scrolls the page on at once', async ({ page }) => {
    const cdp = await open(page);
    await gesture(cdp, { yDistance: -1600 });
    await settle(page);
    await page.getByRole('button', { name: /^Slide 16:/ }).click();
    await page.waitForTimeout(700);
    await record(page);
    await gesture(cdp, { yDistance: -600 });
    await settle(page);
    const tops = (await framesOf(page)).map(({ top }) => top);
    expect(tops.every((top, index) => index === 0 || top <= (tops[index - 1] ?? 0) + 0.5)).toBe(
      true,
    );
    expect(tops.at(-1)).toBeLessThan(-300);
    expect(await slideOf(page)).toBe('run');
  });

  test('a swipe while a long slide plays moves nothing; the next one after it does', async ({
    page,
  }) => {
    const cdp = await open(page);
    await gesture(cdp, { yDistance: -1600 });
    await settle(page);
    await page.getByRole('button', { name: /^Slide 8:/ }).click();
    await page.waitForTimeout(1400);
    await gesture(cdp, { yDistance: -500 });
    expect(await slideOf(page)).toBe('you');
    // "Then you decide" plays for 2.8 s, well over a plain slide's 0.6 s.
    await page.waitForTimeout(400);
    await gesture(cdp, { yDistance: -500 });
    expect(await slideOf(page)).toBe('you');
    await page.waitForTimeout(2400);
    await gesture(cdp, { yDistance: -500 });
    expect(await slideOf(page)).toBe('ai');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a finger's fling from the hero stops the stage at the top", async ({ page }) => {
    const cdp = await open(page);
    await record(page);
    await fling(cdp, { fromY: 800, toY: 100 });
    await settle(page);
    expectToReachTopWithoutPassing(await framesOf(page), 'above');
    expect(await slideOf(page)).toBe('imagine');
  });
});
