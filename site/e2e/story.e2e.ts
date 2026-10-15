import { type CDPSession, expect, type Page, test } from '@playwright/test';

// The story under real input, against the production build. The scroll plays it: the stage sticks
// to the screen over a runway, and the scene follows how far down the runway the reader is, both
// ways, trailing it a moment and gliding to rest exactly where the scroll stopped. The progress
// line under the stage is the timeline's own playhead, so comparing it with the scroll each frame
// shows how the scene follows the input.

/** Where the story's runway starts and how long it is, in px of scroll. */
const runwayOf = (page: Page) =>
  page.evaluate(() => {
    const story = document.querySelector<HTMLElement>('[data-story]');
    if (story === null) throw new Error('the page has no story');
    const beats = Number(getComputedStyle(story).getPropertyValue('--beats'));
    const start = scrollY + story.getBoundingClientRect().top;
    const length = story.offsetHeight - innerHeight;
    return { start, length, beats, beat: length / beats };
  });

type Playhead = { scrolled: number; played: number };

/** How far down the runway the page is, and how far the scene has played, in px of scroll. */
const playheadOf = (page: Page): Promise<Playhead> =>
  page.evaluate(() => {
    const story = document.querySelector<HTMLElement>('[data-story]');
    const progress = document.querySelector<HTMLElement>('[data-progress]');
    if (story === null || progress === null) throw new Error('the page has no story');
    const start = scrollY + story.getBoundingClientRect().top;
    const length = story.offsetHeight - innerHeight;
    return {
      scrolled: Math.min(Math.max(scrollY - start, 0), length),
      played: new DOMMatrix(getComputedStyle(progress).transform).a * length,
    };
  });

/**
 * Waits until the page has stopped scrolling and the scene has come to rest: on the scroll, to
 * the pixel. Polled, not timed, so a slow machine only takes longer.
 */
const settle = async (page: Page) => {
  await expect
    .poll(
      async () => {
        const before = await playheadOf(page);
        await page.waitForTimeout(400);
        const after = await playheadOf(page);
        return (
          after.scrolled === before.scrolled &&
          Math.abs(after.played - before.played) < 0.5 &&
          Math.abs(after.played - after.scrolled) <= 1
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
};

/** Scrolls to `beat` beats down the runway and waits for the scene to come to rest there. */
const scrollToBeat = async (page: Page, beat: number) => {
  const { start, beat: px } = await runwayOf(page);
  await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), start + beat * px);
  await settle(page);
};

const nextFrames = (page: Page) =>
  page.evaluate(
    () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

/** The beat a caption starts on. */
const beatOf = async (page: Page, caption: string) =>
  Number(await page.locator(`[data-caption="${caption}"]`).getAttribute('data-at'));

const opacityOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(element => Number(getComputedStyle(element).opacity));

/** The caption the reader can see: the one fully opaque. */
const shownCaption = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-caption]')]
      .filter(caption => getComputedStyle(caption).opacity === '1')
      .map(caption => caption.dataset.caption),
  );

type Frame = Playhead & { stageTop: number; delta: number };

/** Samples, every frame, the stage's top, how far down the runway the page is, and the playhead. */
const record = (page: Page) =>
  page.evaluate(() => {
    const story = document.querySelector<HTMLElement>('[data-story]');
    const stage = document.querySelector<HTMLElement>('[data-stage]');
    const progress = document.querySelector<HTMLElement>('[data-progress]');
    if (story === null || stage === null || progress === null) throw new Error('no story');
    const frames: Frame[] = [];
    let lastY = scrollY;
    const sample = () => {
      const start = scrollY + story.getBoundingClientRect().top;
      const length = story.offsetHeight - innerHeight;
      const scaleX = new DOMMatrix(getComputedStyle(progress).transform).a;
      frames.push({
        stageTop: stage.getBoundingClientRect().top,
        scrolled: Math.min(Math.max(scrollY - start, 0), length),
        played: scaleX * length,
        delta: Math.abs(scrollY - lastY),
      });
      lastY = scrollY;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    Object.assign(window, { __frames: frames });
  });

const framesOf = (page: Page): Promise<Frame[]> =>
  page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames.splice(0));

/** The frames on the runway, where the stage must never move. */
const onRunwayOf = (frames: Frame[], { length }: { length: number }) => {
  const onRunway = frames.filter(({ scrolled }) => scrolled > 1 && scrolled < length - 1);
  expect(onRunway.length, 'frames sampled on the runway').toBeGreaterThan(5);
  for (const { stageTop } of onRunway) expect(Math.abs(stageTop)).toBeLessThanOrEqual(0.5);
  return onRunway;
};

/**
 * The stage stays put, and the scene trails the scroll: it moves only the way the scroll went,
 * never runs ahead of it, and ends on it, to the pixel.
 */
const expectPinnedAndTrailing = (
  frames: Frame[],
  runway: { length: number },
  direction: 'down' | 'up',
) => {
  onRunwayOf(frames, runway);
  const sign = direction === 'down' ? 1 : -1;
  frames.forEach(({ played, scrolled }, index) => {
    const previous = frames[index - 1];
    if (previous !== undefined) {
      expect(sign * (played - previous.played), 'the scene moved back').toBeGreaterThan(-0.5);
    }
    expect(sign * (played - scrolled), 'the scene ran ahead of the scroll').toBeLessThanOrEqual(1);
  });
  const last = frames.at(-1);
  expect(Math.abs((last?.played ?? Number.NaN) - (last?.scrolled ?? 0))).toBeLessThanOrEqual(1);
};

/** After the scroll stops, the scene glides on for a few frames before it comes to rest. */
const expectToGlide = (frames: Frame[]) => {
  const stopped = frames.findLastIndex(
    ({ scrolled }, index) => scrolled !== frames[index - 1]?.scrolled,
  );
  const gliding = frames
    .slice(stopped + 1)
    .filter(
      ({ played }, index, after) => Math.abs(played - (after[index - 1]?.played ?? played)) > 0.5,
    );
  expect(
    gliding.length,
    'frames the scene moved on after the scroll stopped',
  ).toBeGreaterThanOrEqual(3);
};

/**
 * With no trail (reduced motion), the playhead is where the scroll is: at most one frame's scroll
 * behind it (the scene updates in the frame after the scroll event).
 */
const expectPinnedAndInStep = (frames: Frame[], runway: { length: number }) => {
  const lags = onRunwayOf(frames, runway).map(
    ({ scrolled, played, delta }) => Math.abs(scrolled - played) - delta,
  );
  expect(Math.max(...lags), 'the scene lagged the scroll by more than a frame').toBeLessThanOrEqual(
    2,
  );
};

const open = async (page: Page) => {
  // No consent banner over the stage.
  await page.addInitScript(() => localStorage.setItem('fishball.cookie-consent', 'denied'));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await nextFrames(page);
  return page.context().newCDPSession(page);
};

/** A trackpad swipe, inertia and all: negative `yDistance` scrolls the page down. */
const swipe = (
  cdp: CDPSession,
  { yDistance, speed = 2400 }: { yDistance: number; speed?: number },
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

/** Every story element's opacity and transform, in document order. */
const sceneState = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-story] *')].map(element => {
      const { opacity, transform } = getComputedStyle(element);
      return `${opacity} ${transform}`;
    }),
  );

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the first paint is already the story as the script starts it', async ({ page }) => {
    // Without the bundled script (the state of the first paint, before it runs) and with it, the
    // story's start is the same, piece for piece.
    await page.route('**/_astro/*.js', route => route.abort());
    await open(page);
    await scrollToBeat(page, 0);
    const unscripted = await sceneState(page);
    await page.unroute('**/_astro/*.js');
    await open(page);
    await scrollToBeat(page, 0);
    expect(await sceneState(page)).toEqual(unscripted);
    expect(await shownCaption(page)).toEqual(['race']);
  });

  test('a trackpad swipe plays the story and glides to rest where it stopped', async ({ page }) => {
    const cdp = await open(page);
    const runway = await runwayOf(page);
    await scrollToBeat(page, 0);
    await record(page);
    await swipe(cdp, { yDistance: -runway.beat * 8 });
    await settle(page);
    const frames = await framesOf(page);
    expectPinnedAndTrailing(frames, runway, 'down');
    expectToGlide(frames);
    expect(await shownCaption(page)).not.toEqual(['race']);
  });

  test('a swipe back up plays it back and glides to rest', async ({ page }) => {
    const cdp = await open(page);
    const runway = await runwayOf(page);
    await scrollToBeat(page, 10);
    await record(page);
    await swipe(cdp, { yDistance: runway.beat * 6 });
    await settle(page);
    const frames = await framesOf(page);
    expectPinnedAndTrailing(frames, runway, 'up');
    expectToGlide(frames);
  });

  test('at reading speed the scene trails by under half a caption', async ({ page }) => {
    // Every caption holds the stage for at least a beat, so a scene within half a beat of the
    // scroll shows the caption the reader has scrolled to, or the one just before it.
    const cdp = await open(page);
    const runway = await runwayOf(page);
    await scrollToBeat(page, 1);
    await record(page);
    await swipe(cdp, { yDistance: -runway.beat * 4, speed: 600 });
    await settle(page);
    const frames = await framesOf(page);
    expectPinnedAndTrailing(frames, runway, 'down');
    const lag = Math.max(...frames.map(({ scrolled, played }) => scrolled - played));
    expect(lag / runway.beat, 'beats the scene trailed the scroll by').toBeLessThan(0.5);
  });

  test('a mouse wheel plays it a notch at a time', async ({ page }) => {
    const cdp = await open(page);
    const runway = await runwayOf(page);
    await scrollToBeat(page, 0.5);
    await record(page);
    for (let notch = 0; notch < 12; notch += 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 200,
        y: 400,
        deltaX: 0,
        deltaY: 100,
      });
      await page.waitForTimeout(60);
    }
    await settle(page);
    expectPinnedAndTrailing(await framesOf(page), runway, 'down');
  });

  test('scrolling back plays the story back', async ({ page }) => {
    await open(page);
    const goal = await beatOf(page, 'goal');
    await scrollToBeat(page, goal + 0.6);
    expect(await shownCaption(page)).toEqual(['goal']);
    expect(await opacityOf(page, '.goal-top .lit')).toBe(1);
    await scrollToBeat(page, 0);
    expect(await shownCaption(page)).toEqual(['race']);
    expect(await opacityOf(page, '.goal-top .lit')).toBe(0);
    expect(await opacityOf(page, '.page')).toBe(0);
  });

  test('the keys play it: Page Down, Space and the arrows', async ({ page }) => {
    await open(page);
    await scrollToBeat(page, 0);
    const { start } = await runwayOf(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const before = await page.evaluate(() => scrollY);
    for (const key of ['PageDown', 'Space', 'ArrowDown']) await page.keyboard.press(key);
    await settle(page);
    const after = await page.evaluate(() => scrollY);
    expect(after).toBeGreaterThan(Math.max(before, start) + 400);
    expect(await shownCaption(page)).not.toEqual(['race']);
  });

  test('the narration on show can be selected', async ({ page }) => {
    await open(page);
    const ops = await beatOf(page, 'ops');
    await scrollToBeat(page, ops + 0.6);
    const line = page.locator('[data-caption="ops"] .story-line');
    await line.click({ clickCount: 3 });
    expect(await page.evaluate(() => getSelection()?.toString().trim())).toBe(
      'Ops: what you can do. Here, click a link.',
    );
  });

  test('past the end, the page scrolls on', async ({ page }) => {
    await open(page);
    const { beats } = await runwayOf(page);
    await scrollToBeat(page, beats + 3);
    const stageTop = await page
      .locator('[data-stage]')
      .evaluate(stage => stage.getBoundingClientRect().top);
    expect(stageTop).toBeLessThan(-1000);
    expect(await shownCaption(page)).toEqual(['run']);
    expect(await opacityOf(page, '.run-check')).toBe(1);
    // The scene glided through the goal on the way down, so the confetti fired.
    await expect(page.locator('[data-story]')).toHaveAttribute('data-celebrate', '');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a finger's fling plays the story and glides to rest where it stopped", async ({ page }) => {
    const cdp = await open(page);
    const runway = await runwayOf(page);
    await scrollToBeat(page, 0.2);
    await record(page);
    await fling(cdp, { fromY: 800, toY: 150 });
    await settle(page);
    expectPinnedAndTrailing(await framesOf(page), runway, 'down');
  });
});

test.describe('with less motion', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('the scene keeps step with the scroll, with no trail', async ({ page }) => {
    const cdp = await open(page);
    const runway = await runwayOf(page);
    await scrollToBeat(page, 0);
    await record(page);
    await swipe(cdp, { yDistance: -runway.beat * 8 });
    await settle(page);
    expectPinnedAndInStep(await framesOf(page), runway);
  });

  test('nothing travels: pieces fade in place', async ({ page }) => {
    await open(page);
    // Mid-way through the page's entrance, the three things' flights, and the code's.
    for (const [caption, offset] of [
      ['land', 0.1],
      ['you', 0.3],
      ['code', 0.3],
    ] as const) {
      await scrollToBeat(page, (await beatOf(page, caption)) + offset);
      const moved = await page.evaluate(() =>
        [...document.querySelectorAll('[data-scene] *')].flatMap(element => {
          const { transform } = getComputedStyle(element);
          if (transform === 'none') return [];
          const { e, f } = new DOMMatrix(transform);
          return Math.abs(e) > 0.5 || Math.abs(f) > 0.5 ? [element.className] : [];
        }),
      );
      expect(moved, `moved at ${caption}`).toEqual([]);
    }
  });
});

test.describe('read as prose', () => {
  test('without script, the narration and the finished code and run read in the page', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');
    const captions = page.locator('[data-caption]');
    await expect(captions).toHaveCount(9);
    for (const caption of await captions.all()) await expect(caption).toBeVisible();
    await expect(page.locator('.code-window')).toBeVisible();
    // The scene's other pieces are the stage's: here they stay out of the way.
    for (const piece of ['.page', '.column', '.decider', '.row']) {
      await expect(page.locator(piece)).toBeHidden();
    }
    await expect(page.locator('.term-line').last()).toContainText('goal met');
    expect(await opacityOf(page, '[data-caption="run"]')).toBe(1);
    await context.close();
  });

  test('on a screen too short for the stage, too', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 480 });
    await open(page);
    for (const caption of await page.locator('[data-caption]').all()) {
      expect(await caption.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    }
    await expect(page.locator('.term-line').last()).toBeVisible();
  });
});
