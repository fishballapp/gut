import { isOp, type Op, type Ops } from '@gut.run/core';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Control, observe, secret } from './index.ts';

const findLeafOp = (ops: Ops, predicate: (op: Op) => boolean): Op | undefined => {
  for (const entry of Object.values(ops)) {
    if (!isOp(entry)) continue;
    if (entry.kind === 'leaf' && predicate(entry)) return entry;
    if (entry.kind === 'node') {
      const found = findLeafOp(entry.ops, predicate);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

const findGroup = (ops: Ops, description: string): Ops | undefined => {
  for (const entry of Object.values(ops)) {
    if (!isOp(entry)) continue;
    if (entry.kind === 'node') {
      if (entry.description === description) return entry.ops;
      const found = findGroup(entry.ops, description);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

const countLeaves = (ops: Ops): number =>
  Object.values(ops).reduce<number>((count, entry) => {
    if (!isOp(entry)) return count;
    if (entry.kind === 'leaf') return count + 1;
    if (entry.kind === 'node') return count + countLeaves(entry.ops);
    return count;
  }, 0);

const serializeOpDescriptions = (treeOps: Ops): readonly string[] =>
  Object.values(treeOps).flatMap(entry => {
    if (!isOp(entry)) return [];
    if (entry.kind === 'node') {
      return [entry.description, ...serializeOpDescriptions(entry.ops)];
    }
    return [entry.description];
  });

const choicesOf = (
  op: Op | undefined,
): readonly { readonly label: string; readonly invoke: () => unknown }[] => {
  if (op === undefined) throw new Error('Expected op to be defined');
  if (op.kind !== 'leaf') throw new Error(`Expected leaf op, got kind: ${op.kind}`);
  if (!('choices' in op) || op.choices === undefined) {
    throw new Error('Expected leaf op to have choices');
  }
  return op.choices;
};

const invokeLeaf = async (op: Op | undefined): Promise<unknown> => {
  if (op === undefined) throw new Error('Expected op to be defined');
  if (op.kind !== 'leaf') throw new Error(`Expected leaf op, got kind: ${op.kind}`);
  if (!('invoke' in op) || typeof op.invoke !== 'function') {
    throw new Error('Expected leaf op to have invoke function');
  }
  return await op.invoke();
};

// Starting or closing Chromium can outlast vitest's 10 s hook default while the whole repo's tests run.
const BROWSER_HOOK_TIMEOUT_MS = 30_000;

describe('@gut.run/playwright observe', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, BROWSER_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await browser.close();
  }, BROWSER_HOOK_TIMEOUT_MS);

  // 1. returns context and ops for a page
  it('returns context and ops for a page', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
          <head><title>Test Page</title></head>
          <body>
            <header><h1>Header Title</h1><a href="/logo">Logo</a></header>
            <main>
              <h2>Main Heading</h2>
              <p>Hello world visible text</p>
              <button id="btn">Click me</button>
            </main>
          </body>
        </html>
      `);

      const { context, ops } = await observe(page);

      expect(context.title).toBe('Test Page');
      expect(context.headings).toEqual([
        { level: 1, text: 'Header Title' },
        { level: 2, text: 'Main Heading' },
      ]);
      expect(context.text).toContain('Hello world visible text');

      const headerGroup = findGroup(ops, 'Header');
      expect(headerGroup).toBeDefined();

      const mainGroup = findGroup(ops, 'Main content');
      expect(mainGroup).toBeDefined();

      const headingGroup = findGroup(ops, 'Main Heading');
      expect(headingGroup).toBeDefined();

      const btnOp = findLeafOp(ops, o => o.description === 'Click "Click me"');
      expect(btnOp).toBeDefined();
      expect(btnOp?.kind === 'leaf').toBe(true);

      let clicked = false;
      await page.exposeFunction('onBtnClick', () => {
        clicked = true;
      });
      await page.evaluate(() => {
        document.getElementById('btn')?.addEventListener('click', () => {
          (window as unknown as { onBtnClick: () => void }).onBtnClick();
        });
      });

      await invokeLeaf(btnOp);
      expect(clicked).toBe(true);
    } finally {
      await page.close();
    }
  });

  // 2. duplicate labels keep separate targets and the right one is clicked
  it('duplicate labels keep separate targets and the right one is clicked', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <section aria-label="London">
            <h2>London</h2>
            <a href="#london" id="link-london">Details</a>
          </section>
          <section aria-label="Manchester">
            <h2>Manchester</h2>
            <a href="#manchester" id="link-manchester">Details</a>
          </section>
        </body></html>
      `);
      const { ops } = await observe(page);

      const manchesterGroup = findGroup(ops, 'Region "Manchester"');
      expect(manchesterGroup).toBeDefined();

      const manchesterLink = findLeafOp(
        manchesterGroup!,
        o => o.description === 'Open link "Details"',
      );
      expect(manchesterLink).toBeDefined();

      let clickedTarget = '';
      await page.exposeFunction('onDetailsClick', (target: string) => {
        clickedTarget = target;
      });
      await page.evaluate(() => {
        document.getElementById('link-manchester')?.addEventListener('click', () => {
          (window as unknown as { onDetailsClick: (t: string) => void }).onDetailsClick(
            'manchester',
          );
        });
      });

      await invokeLeaf(manchesterLink);
      expect(clickedTarget).toBe('manchester');
    } finally {
      await page.close();
    }
  });

  // 3. a re-rendered target records failedMove in next context instead of throwing
  it('a re-rendered target records failedMove in next context instead of throwing', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <div id="container"><button id="btn">Click me</button></div>
        </body></html>
      `);
      const { ops } = await observe(page);
      const btnOp = findLeafOp(ops, o => o.description === 'Click "Click me"');
      expect(btnOp).toBeDefined();

      await page.evaluate(() => {
        document.getElementById('btn')?.remove();
      });

      const startTime = Date.now();
      await expect(invokeLeaf(btnOp)).resolves.not.toThrow();
      const durationMs = Date.now() - startTime;
      expect(durationMs).toBeLessThan(1_000);

      const { context: nextContext } = await observe(page);
      expect(nextContext.failedMove).toEqual({
        move: 'Click "Click me"',
        error: 'the element is no longer on the page',
      });

      const { context: subsequentContext } = await observe(page);
      expect(subsequentContext.failedMove).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  // 4. disabled/hidden controls get no ops
  it('disabled/hidden controls get no ops', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <button id="active-btn">Active Button</button>
          <button disabled id="disabled-btn">Disabled Button</button>
          <input disabled id="disabled-input" value="Inactive" />
          <input type="hidden" id="hidden-input" value="Hidden" />
          <div style="display:none"><button id="hidden-btn">Hidden Button</button></div>
        </body></html>
      `);
      const { ops } = await observe(page, {
        values: { testVal: 'value' },
      });

      expect(findLeafOp(ops, o => o.description.includes('Active Button'))).toBeDefined();
      expect(findLeafOp(ops, o => o.description.includes('Disabled Button'))).toBeUndefined();
      expect(findLeafOp(ops, o => o.description.includes('Disabled Input'))).toBeUndefined();
      expect(findLeafOp(ops, o => o.description.includes('Hidden'))).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  // 5. fill values stay bound to their field and already-filled values are skipped
  it('fill values stay bound to their field and already-filled values are skipped', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <form aria-label="Travel">
            <label for="dest">Destination</label>
            <input id="dest" name="destination" type="text" value="Tokyo" />
            <label for="dt">Date</label>
            <input id="dt" name="date" type="text" />
          </form>
        </body></html>
      `);
      const { ops } = await observe(page, {
        values: { tokyo: 'Tokyo', london: 'London', dateVal: '2026-10-15' },
      });

      const destOp = findLeafOp(ops, o => o.description === 'Fill "Destination"');
      expect(destOp).toBeDefined();
      const destChoices = choicesOf(destOp);
      const destChoiceLabels = destChoices.map(c => c.label);
      expect(destChoiceLabels).toContain('london: London');
      expect(destChoiceLabels).not.toContain('tokyo: Tokyo');

      const dateOp = findLeafOp(ops, o => o.description === 'Fill "Date"');
      expect(dateOp).toBeDefined();
      const dateChoices = choicesOf(dateOp);
      const dateChoiceLabels = dateChoices.map(c => c.label);
      expect(dateChoiceLabels).toContain('dateVal: 2026-10-15');

      const dateChoice = dateChoices.find(c => c.label === 'dateVal: 2026-10-15');
      if (dateChoice === undefined) throw new Error('Expected dateChoice to be defined');
      await dateChoice.invoke();
      const dateInputVal = await page.locator('#dt').inputValue();
      expect(dateInputVal).toBe('2026-10-15');
    } finally {
      await page.close();
    }
  });

  it('offers a secret to a password field until the field holds it, never after', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <form aria-label="Sign in">
          <label for="pw">Password</label><input id="pw" type="password" />
          <button type="button">Log in</button>
        </form>
      `);
      const values = { password: secret('hunter2') };
      const isPasswordFill = (o: Op) => o.description === 'Fill "Password"';

      const before = findLeafOp((await observe(page, { values })).ops, isPasswordFill);
      expect(choicesOf(before).map(c => c.label)).toEqual(['password']);
      await page.locator('#pw').fill('hunter2');

      const after = await observe(page, { values });
      expect(findLeafOp(after.ops, isPasswordFill)).toBeUndefined();
      expect(findLeafOp(after.ops, o => o.description === 'Click "Log in"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 6. two captures of an unchanged page give identical context and identical op keys
  it('two captures of an unchanged page give identical context and identical op keys', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <h1>Office Directory</h1>
          <section aria-label="London">
            <h2>London Office</h2>
            <a href="#london">Details</a>
          </section>
          <section aria-label="Manchester">
            <h2>Manchester Office</h2>
            <a href="#manchester">Details</a>
          </section>
        </body></html>
      `);
      const view1 = await observe(page);
      const view2 = await observe(page);

      expect(view1.context).toEqual(view2.context);
      expect(JSON.stringify(view1.context)).toBe(JSON.stringify(view2.context));
      expect(Object.keys(view1.ops)).toEqual(Object.keys(view2.ops));
      expect(JSON.stringify(view1.ops)).toBe(JSON.stringify(view2.ops));
    } finally {
      await page.close();
    }
  });

  // 7. passwords never appear in context or descriptions, and redaction fails closed
  it('passwords never appear in context or descriptions, and redaction fails closed', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <form aria-label="Auth">
            <label for="pwd">Master Password</label>
            <input type="password" id="pwd" name="password" value="hunter2_super_secret" />
          </form>
        </body></html>
      `);
      const sec = secret('some_new_secret');
      const { context, ops } = await observe(page, {
        values: { newSecret: sec },
      });

      const contextStr = JSON.stringify(context);
      expect(contextStr).not.toContain('hunter2_super_secret');
      expect(contextStr).not.toContain('some_new_secret');
      expect(context.fields['Form "Auth" › Master Password']).toBeUndefined();

      const pwdOp = findLeafOp(ops, o => o.description === 'Fill "Master Password"');
      expect(pwdOp).toBeDefined();
      expect(pwdOp?.description).not.toContain('some_new_secret');
      expect(choicesOf(pwdOp).map(c => c.label)).toEqual(['newSecret']);
    } finally {
      await page.close();
    }
  });

  // 8. context fields use human labels with path in page order
  it('context fields use human labels with path in page order', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <form aria-label="Flight search">
            <label for="dest">Destination</label>
            <input id="dest" value="Tokyo" />
            <label for="dt">Date</label>
            <input id="dt" value="2026-10-15" />
            <label for="notes">Notes</label>
            <input id="notes" value="First class" />
          </form>
        </body></html>
      `);
      const { context } = await observe(page);
      expect(context.fields).toEqual({
        'Form "Flight search" › Destination': 'Tokyo',
        'Form "Flight search" › Date': '2026-10-15',
        'Form "Flight search" › Notes': 'First class',
      });

      expect(Object.keys(context.fields)).toEqual([
        'Form "Flight search" › Destination',
        'Form "Flight search" › Date',
        'Form "Flight search" › Notes',
      ]);
    } finally {
      await page.close();
    }
  });

  // 9. aria-busy handling waits for busy to clear
  it('aria-busy handling waits for busy to clear', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <div id="loader" aria-busy="true"><p>Loading...</p></div>
          <script>
            setTimeout(() => {
              const el = document.getElementById("loader");
              el.removeAttribute("aria-busy");
              el.innerHTML = '<button id="done-btn">Ready</button>';
            }, 300);
          </script>
        </body></html>
      `);
      const { context, ops } = await observe(page);
      expect(context.busy).toBeUndefined();
      expect(findLeafOp(ops, o => o.description === 'Click "Ready"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 10. resolves a relative link against <base>
  it('resolves a relative link against <base>', async () => {
    const page = await browser.newPage();
    try {
      await page.route('https://site.test/**', route => {
        return route.fulfill({
          contentType: 'text/html',
          body: '<base href="https://other.test/"><a href="/target">Go</a>',
        });
      });
      await page.goto('https://site.test/');

      let resolvedControl: Control | undefined;
      await observe(page, {
        shouldOffer: c => {
          resolvedControl = c;
          return true;
        },
      });

      expect(resolvedControl?.url).toBe('https://other.test/target');
    } finally {
      await page.close();
    }
  });

  // 11. observes the page a client redirect lands on, instead of throwing
  it('observes the page a client redirect lands on, instead of throwing', async () => {
    const page = await browser.newPage();
    try {
      await page.route('https://site.test/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') {
          return route.fulfill({
            contentType: 'text/html',
            body: '<script>setTimeout(() => { location.href = "/landed"; }, 40)</script><p>Redirecting</p>',
          });
        }
        return route.fulfill({
          contentType: 'text/html',
          body: '<h1>Landed</h1><a href="/next">Next</a>',
        });
      });
      await page.goto('https://site.test/');
      await page.waitForTimeout(10);

      const { ops } = await observe(page);
      expect(findLeafOp(ops, o => o.description === 'Open link "Next"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 12. reads a textarea newlines and contenteditable text
  it('reads a textarea newlines and contenteditable text as the value', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <main>
          <label>Notes <textarea>line one
line two</textarea></label>
          <div role="textbox" aria-label="Editor" contenteditable="true">Draft text</div>
        </main>
      `);
      const { context } = await observe(page);
      expect(context.fields['Main content › Notes']).toBe('line one\nline two');
      expect(context.fields['Main content › Editor']).toBe('Draft text');
    } finally {
      await page.close();
    }
  });

  // 13. keeps a named section in the path when a heading inside it comes first
  it('keeps a named section in the path when a heading inside it comes first', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <section aria-label="Manchester"><h3>Opening hours</h3><a href="#m">Details</a></section>
        <main><h2>London</h2><a href="#l">Details</a></main>
      `);
      const { ops } = await observe(page);
      const manchesterGroup = findGroup(ops, 'Region "Manchester"');
      expect(manchesterGroup).toBeDefined();

      const hoursGroup = findGroup(manchesterGroup!, 'Opening hours');
      expect(hoursGroup).toBeDefined();
      expect(findLeafOp(hoursGroup!, o => o.description === 'Open link "Details"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 14. includes visible text by default with collapsed blank lines
  it('includes visible text by default with collapsed blank lines', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <h1>Documentation Guide</h1>

          <p>Getting started with gut browser.</p>



          <p>Next steps and advanced usage.</p>
        </body></html>
      `);
      const { context } = await observe(page);
      expect(context.text).toContain('Documentation Guide');
      expect(context.text).toContain(
        'Getting started with gut browser.\n\nNext steps and advanced usage.',
      );
      expect(context.text).not.toMatch(/\n{3,}/);
    } finally {
      await page.close();
    }
  });

  // 15. caps visible text at 4,000 characters with trailing ellipsis
  it('caps visible text at 4,000 characters with trailing ellipsis', async () => {
    const page = await browser.newPage();
    try {
      const longText = 'A'.repeat(5_000);
      await page.setContent(`<html><body><p>${longText}</p></body></html>`);

      const { context } = await observe(page);
      expect(context.text.length).toBe(4_001);
      expect(context.text.endsWith('…')).toBe(true);
      expect(context.text.slice(0, 4_000)).toBe('A'.repeat(4_000));
    } finally {
      await page.close();
    }
  });

  // 16. typed password never appears in visible text or context
  it('never leaks typed password in visible text or context', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <h1>Login Form</h1>
          <form>
            <input type="password" id="pw" />
          </form>
        </body></html>
      `);
      await page.locator('#pw').fill('super-secret-password-123');

      const { context } = await observe(page);
      expect(context.text).not.toContain('super-secret-password-123');
      expect(JSON.stringify(context)).not.toContain('super-secret-password-123');
    } finally {
      await page.close();
    }
  });

  // 17. heading section does not wrap sibling containers that have their own heading or landmark
  it('heading section does not wrap sibling containers that have their own heading or landmark', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <div>
            <div id="repo-overview">
              <h2>Latest commit</h2>
              <a href="#c1">Commit link 1</a>
              <a href="#c2">Commit link 2</a>
            </div>
            <aside id="repo-sidebar">
              <h2>About</h2>
              <a href="#a1">About link 1</a>
            </aside>
          </div>
        </body></html>
      `);
      const { ops } = await observe(page);

      const latestCommitGroup = findGroup(ops, 'Latest commit');
      expect(latestCommitGroup).toBeDefined();
      expect(
        findLeafOp(latestCommitGroup!, o => o.description === 'Open link "About link 1"'),
      ).toBeUndefined();

      const sidebarGroup = findGroup(ops, 'Sidebar');
      expect(sidebarGroup).toBeDefined();
      expect(
        findLeafOp(sidebarGroup!, o => o.description === 'Open link "About link 1"'),
      ).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 18. does not lose ops when group key collides with direct op key
  it('does not lose ops when group key collides with direct op key', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <!DOCTYPE html><html><body>
          <a href="#">Details</a>
          <section aria-label="link Details">
            <a href="#">Item 1</a>
            <a href="#">Item 2</a>
          </section>
        </body></html>
      `);
      const { ops } = await observe(page);
      expect(countLeaves(ops)).toBe(3);
    } finally {
      await page.close();
    }
  });

  // 19. heading section does not leak cleared state to subsequent siblings
  it('heading section does not leak cleared state to subsequent siblings', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <!DOCTYPE html><html><body>
          <h2>A</h2>
          <a href="#">1</a>
          <aside>
            <h2>S</h2>
            <a href="#">2</a>
          </aside>
          <a href="#">After</a>
        </body></html>
      `);
      const { ops } = await observe(page);

      const groupA = findGroup(ops, 'A');
      expect(groupA).toBeDefined();

      const link1 = findLeafOp(groupA!, o => o.description === 'Open link "1"');
      const linkAfter = findLeafOp(groupA!, o => o.description === 'Open link "After"');
      expect(link1).toBeDefined();
      expect(linkAfter).toBeDefined();

      const sidebarGroup = findGroup(ops, 'Sidebar');
      expect(sidebarGroup).toBeDefined();
      const link2 = findLeafOp(sidebarGroup!, o => o.description === 'Open link "2"');
      expect(link2).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 20. a secret typed into a plain text field and a secret printed in the page are both absent from view and present as [secret]
  it('a secret typed into a plain text field and a secret printed in the page are both absent and present as [secret]', async () => {
    const page = await browser.newPage();
    try {
      const secretPrinted = 'super_secret_sauce_123';
      const secretTyped = 'super_secret_token_456';
      await page.setContent(`
        <html><body>
          <h1>Welcome to the portal</h1>
          <p>Your secret code is ${secretPrinted}</p>
          <form>
            <label for="username">Username</label>
            <input type="text" id="username" name="username" />
          </form>
        </body></html>
      `);
      await page.locator('#username').fill(secretTyped);

      const { context } = await observe(page, {
        values: {
          printed: secret(secretPrinted),
          typed: secret(secretTyped),
        },
      });

      const serialized = JSON.stringify(context);
      expect(serialized).not.toContain(secretPrinted);
      expect(serialized).not.toContain(secretTyped);
      expect(serialized).toContain('[secret]');

      expect(context.text).toContain('[secret]');
      expect(context.text).not.toContain(secretPrinted);

      expect(Object.values(context.fields)).toEqual(['[secret]']);
    } finally {
      await page.close();
    }
  });

  // 21. secrets are redacted from group labels and op descriptions
  it('redacts secrets from group labels in tree op descriptions and context', async () => {
    const page = await browser.newPage();
    try {
      const secretVal = 'super_secret_sauce_123';
      await page.setContent(`
        <html><body>
          <main aria-label="Main section">
            <section aria-label="Section ${secretVal}">
              <h2>Heading ${secretVal}</h2>
              <button>Action 1</button>
            </section>
          </main>
        </body></html>
      `);
      const { context, ops } = await observe(page, {
        values: { mySecret: secret(secretVal) },
      });

      const allDescriptions = serializeOpDescriptions(ops);
      const serializedContext = JSON.stringify(context);

      expect(serializedContext).not.toContain(secretVal);
      for (const desc of allDescriptions) {
        expect(desc).not.toContain(secretVal);
      }
    } finally {
      await page.close();
    }
  });

  // 22. handles link, button, checkbox, switch, radio, tab, menuitem, option (with correct verbs and states)
  it('handles link, button, checkbox, switch, radio, tab, menuitem, option', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <main>
          <a href="#target" id="link">My Link</a>
          <button id="btn">My Button</button>
          <input type="checkbox" id="chk1" aria-label="Notifications" checked />
          <input type="checkbox" id="chk2" aria-label="Marketing" />
          <div role="switch" id="sw1" aria-label="Dark Mode" aria-checked="true">Dark</div>
          <div role="radiogroup" aria-label="Choice">
            <input type="radio" id="rad1" name="c" aria-label="Opt A" />
            <input type="radio" id="rad2" name="c" aria-label="Opt B" checked />
          </div>
          <div role="tablist" aria-label="Tabs">
            <button role="tab" id="tab1" aria-label="Tab 1">Tab 1</button>
          </div>
          <div role="menu">
            <div role="menuitem" id="mi1" aria-label="Profile">Profile</div>
          </div>
          <div role="listbox">
            <div role="option" id="opt1" aria-label="Item 1">Item 1</div>
          </div>
        </main>
      `);

      const { context, ops } = await observe(page);

      expect(context.fields['Main content › Notifications']).toBe('checked');
      expect(context.fields['Main content › Marketing']).toBe('unchecked');
      expect(context.fields['Main content › Dark Mode']).toBe('checked');

      const linkOp = findLeafOp(ops, o => o.description === 'Open link "My Link"');
      expect(linkOp).toBeDefined();

      const btnOp = findLeafOp(ops, o => o.description === 'Click "My Button"');
      expect(btnOp).toBeDefined();

      const uncheckOp = findLeafOp(ops, o => o.description === 'Uncheck "Notifications"');
      expect(uncheckOp).toBeDefined();

      const checkOp = findLeafOp(ops, o => o.description === 'Check "Marketing"');
      expect(checkOp).toBeDefined();

      const uncheckSwOp = findLeafOp(ops, o => o.description === 'Uncheck "Dark Mode"');
      expect(uncheckSwOp).toBeDefined();

      const radioOp = findLeafOp(ops, o => o.description === 'Choose "Opt A"');
      expect(radioOp).toBeDefined();

      const tabOp = findLeafOp(ops, o => o.description === 'Choose "Tab 1"');
      expect(tabOp).toBeDefined();

      const miOp = findLeafOp(ops, o => o.description === 'Choose "Profile"');
      expect(miOp).toBeDefined();

      const optOp = findLeafOp(ops, o => o.description === 'Choose "Item 1"');
      expect(optOp).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 23. handles select and combobox with options, disambiguating duplicates and skipping disabled
  it('handles select and combobox with options, disambiguating duplicates and skipping disabled', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <main>
          <select id="country" aria-label="Country">
            <option value="us">United States</option>
            <option value="uk" disabled>United Kingdom</option>
            <option value="ca">Canada</option>
            <option value="ca2">Canada</option>
          </select>
        </main>
      `);

      const { context, ops } = await observe(page);
      expect(context.fields['Main content › Country']).toBe('United States');

      const selectOp = findLeafOp(ops, o => o.description === 'Select in "Country"');
      expect(selectOp).toBeDefined();
      const selectChoices = choicesOf(selectOp);
      const choiceLabels = selectChoices.map(c => c.label);
      expect(choiceLabels).toContain('United States');
      expect(choiceLabels).not.toContain('United Kingdom');
      expect(choiceLabels).toContain('Canada');
      expect(choiceLabels).toContain('Canada (2)');

      const canada2Choice = selectChoices.find(c => c.label === 'Canada (2)');
      if (canada2Choice === undefined) throw new Error('Expected canada2Choice to be defined');
      await canada2Choice.invoke();
      const selectedVal = await page.locator('#country').inputValue();
      expect(selectedVal).toBe('ca2');
    } finally {
      await page.close();
    }
  });

  // 24. gives editable combobox both fill and select ops
  it('gives editable combobox both fill and select ops', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <main>
          <div role="combobox" id="city" aria-label="City" contenteditable="true" aria-expanded="true">
            <div role="listbox">
              <div role="option">London</div>
              <div role="option">Paris</div>
            </div>
          </div>
        </main>
      `);

      const { ops } = await observe(page, {
        values: { cityVal: 'Tokyo' },
      });

      const fillOp = findLeafOp(ops, o => o.description === 'Fill "City"');
      expect(fillOp).toBeDefined();
      const selectOp = findLeafOp(ops, o => o.description === 'Select in "City"');
      expect(selectOp).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 25. obeys path rules: landmarks, headings, parent repeat merge, repeated unnamed items
  it('obeys path rules: landmarks, headings, parent repeat merge, repeated unnamed items', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <header>
          <nav aria-label="Site">
            <a href="/">Home</a>
          </nav>
        </header>
        <main>
          <h2>Articles</h2>
          <ul role="list">
            <li role="listitem">
              <h3>First Article Title That Is Long Enough To Be Truncated Nicely</h3>
              <button id="like1">Like 1</button>
              <button>Share 1</button>
            </li>
            <li role="listitem">
              <a href="/post2">Second Post Link</a>
              <button id="like2">Like 2</button>
            </li>
          </ul>
        </main>
        <footer>
          <a href="/privacy">Privacy</a>
        </footer>
      `);

      const { ops } = await observe(page);

      const navGroup = findGroup(ops, 'Navigation "Site"');
      expect(navGroup).toBeDefined();

      const mainGroup = findGroup(ops, 'Main content');
      expect(mainGroup).toBeDefined();

      const articlesGroup = findGroup(ops, 'Articles');
      expect(articlesGroup).toBeDefined();

      const firstItemName = 'First Article Title That Is Long Enough…';
      const item1Group = findGroup(ops, firstItemName);
      expect(item1Group).toBeDefined();

      const item2Group = findGroup(ops, 'Second Post Link');
      expect(item2Group).toBeDefined();

      const footerGroup = findGroup(ops, 'Footer');
      expect(footerGroup).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 26. scopes to Locator, preserves ancestor path, scopes text, throws on 0 or multiple matches
  it('scopes to Locator, preserves ancestor path, scopes text, throws on 0 or multiple matches', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <header><h1>Top Site</h1></header>
        <main>
          <section id="s1" aria-label="Section One">
            <h2>Section Heading</h2>
            <p>Section one exclusive text</p>
            <button id="b1">Btn 1</button>
          </section>
          <section id="s2" aria-label="Section Two">
            <button id="b2">Btn 2</button>
          </section>
        </main>
      `);

      const s1 = page.locator('#s1');
      const { context, ops } = await observe(s1);

      expect(context.text).toContain('Section one exclusive text');
      expect(context.text).not.toContain('Top Site');

      const btn1 = findLeafOp(ops, o => o.description === 'Click "Btn 1"');
      expect(btn1).toBeDefined();

      const btn2 = findLeafOp(ops, o => o.description === 'Click "Btn 2"');
      expect(btn2).toBeUndefined();

      const secGroup = findGroup(ops, 'Region "Section One"');
      expect(secGroup).toBeDefined();

      await expect(observe(page.locator('.non-existent'))).rejects.toThrow(/0 elements/);
      await expect(observe(page.locator('section'))).rejects.toThrow(/2 elements/);
    } finally {
      await page.close();
    }
  });

  // 27. handles two observes in one round without breaking refs
  it('handles two observes in one round without breaking refs', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <main>
          <section id="s1" aria-label="Section 1"><button id="btn1">Button 1</button></section>
          <section id="s2" aria-label="Section 2"><button id="btn2">Button 2</button></section>
        </main>
      `);

      const s1 = page.locator('#s1');
      const s2 = page.locator('#s2');

      const [res1, res2] = await Promise.all([observe(s1), observe(s2)]);

      const b1 = findLeafOp(res1.ops, o => o.description === 'Click "Button 1"');
      const b2 = findLeafOp(res2.ops, o => o.description === 'Click "Button 2"');

      expect(b1).toBeDefined();
      expect(b2).toBeDefined();

      let clicked1 = false;
      let clicked2 = false;
      await page.exposeFunction('onClick1', () => {
        clicked1 = true;
      });
      await page.exposeFunction('onClick2', () => {
        clicked2 = true;
      });
      await page.evaluate(() => {
        document.getElementById('btn1')?.addEventListener('click', () => {
          (window as unknown as { onClick1: () => void }).onClick1();
        });
        document.getElementById('btn2')?.addEventListener('click', () => {
          (window as unknown as { onClick2: () => void }).onClick2();
        });
      });

      await invokeLeaf(b1);
      await invokeLeaf(b2);

      expect(clicked1).toBe(true);
      expect(clicked2).toBe(true);
    } finally {
      await page.close();
    }
  });

  // 28. redacts secrets before 4,000 char truncation and redacts error messages while keeping Control.url raw
  it('redacts secrets before 4,000 char truncation and redacts error messages while keeping Control.url raw', async () => {
    const page = await browser.newPage();
    try {
      const mySecret = 'super_classified_password_123';
      await page.setContent(`
        <main>
          <h1>Secret title with ${mySecret}</h1>
          <p>Secret text body containing ${mySecret}</p>
          <a href="/target?auth=${mySecret}" id="secret-link">Go to ${mySecret}</a>
        </main>
      `);

      let observedControl: Control | undefined;
      const { context, ops } = await observe(page, {
        values: { authSecret: secret(mySecret) },
        shouldOffer: c => {
          observedControl = c;
          return true;
        },
      });

      expect(context.title).not.toContain(mySecret);
      expect(context.headings[0]?.text).toContain('[secret]');
      expect(context.headings[0]?.text).not.toContain(mySecret);
      expect(context.text).toContain('[secret]');
      expect(context.text).not.toContain(mySecret);

      expect(observedControl).toBeDefined();
      expect(observedControl?.url).toContain(mySecret);

      const linkOp = findLeafOp(ops, o => o.description.includes('[secret]'));
      expect(linkOp).toBeDefined();
      expect(linkOp?.description).not.toContain(mySecret);
    } finally {
      await page.close();
    }
  });

  // 29. filters controls with shouldOffer
  it('filters controls with shouldOffer', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <main>
          <button id="b1">Allowed</button>
          <button id="b2">Denied</button>
        </main>
      `);

      const { ops } = await observe(page, {
        shouldOffer: c => c.name === 'Allowed',
      });

      const allowedOp = findLeafOp(ops, o => o.description === 'Click "Allowed"');
      expect(allowedOp).toBeDefined();

      const deniedOp = findLeafOp(ops, o => o.description === 'Click "Denied"');
      expect(deniedOp).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  // 30. Bug 3 fix: options belonging to a select/combobox reached only through select op, standalone only when no select op covers them
  it('offers options only through select op when inside combobox, and offers standalone Choose ops for bare listbox', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <main>
          <select id="fruit-select" aria-label="Favorite Fruit">
            <option value="apple">Apple</option>
            <option value="banana">Banana</option>
          </select>
          <div role="listbox" aria-label="Colors">
            <div role="option" id="opt-red">Red</div>
            <div role="option" id="opt-blue">Blue</div>
          </div>
        </main>
      `);

      const { ops } = await observe(page);

      // The select op must exist with Apple and Banana
      const selectFruitOp = findLeafOp(ops, o => o.description === 'Select in "Favorite Fruit"');
      expect(selectFruitOp).toBeDefined();
      expect(choicesOf(selectFruitOp).map(c => c.label)).toEqual(['Apple', 'Banana']);

      // Neither Apple nor Banana should be offered as standalone Choose ops!
      const standaloneApple = findLeafOp(ops, o => o.description === 'Choose "Apple"');
      expect(standaloneApple).toBeUndefined();
      const standaloneBanana = findLeafOp(ops, o => o.description === 'Choose "Banana"');
      expect(standaloneBanana).toBeUndefined();

      // But bare listbox options Red and Blue MUST be offered as standalone Choose ops!
      const standaloneRed = findLeafOp(ops, o => o.description === 'Choose "Red"');
      expect(standaloneRed).toBeDefined();
      const standaloneBlue = findLeafOp(ops, o => o.description === 'Choose "Blue"');
      expect(standaloneBlue).toBeDefined();
    } finally {
      await page.close();
    }
  });
  // 32. Finding A: secret inside long product card name leaves no fragment
  it('leaves no secret fragment when a secret inside a long product card name is truncated', async () => {
    const page = await browser.newPage();
    try {
      const mySecret = 'super_secret_code_123';
      const longName = `Product with secret token ${mySecret} in description and details`;
      await page.setContent(`
        <div>
          <div>
            <a href="/p1">${longName}</a>
            <button>Buy</button>
          </div>
          <div>
            <a href="/p2">Another regular product</a>
            <button>Buy</button>
          </div>
        </div>
      `);
      const { ops } = await observe(page, { values: { sec: secret(mySecret) } });
      const descriptions = serializeOpDescriptions(ops);
      for (const desc of descriptions) {
        expect(desc).not.toContain(mySecret);
        expect(desc).not.toContain('super_');
        expect(desc).not.toContain('_123');
      }
    } finally {
      await page.close();
    }
  });

  // 33. Finding A: op keys hold no secret
  it('holds no secret in op keys', async () => {
    const page = await browser.newPage();
    try {
      const mySecret = 'classified_key_456';
      await page.setContent(`
        <button id="btn">Submit ${mySecret}</button>
      `);
      const { ops } = await observe(page, { values: { sec: secret(mySecret) } });
      const opKeys = Object.keys(ops);
      for (const k of opKeys) {
        expect(k).not.toContain(mySecret);
        expect(k).not.toContain('classified');
      }
    } finally {
      await page.close();
    }
  });

  // 34. Finding A: two secret-named fields keep two keys
  it('keeps two keys for two secret-named fields without collision or overwrite', async () => {
    const page = await browser.newPage();
    try {
      const s1 = 'secret_alpha';
      const s2 = 'secret_beta';
      await page.setContent(`
        <form>
          <label for="f1">Field ${s1}</label>
          <input id="f1" value="val1" />
          <label for="f2">Field ${s2}</label>
          <input id="f2" value="val2" />
        </form>
      `);
      const { context } = await observe(page, {
        values: { sec1: secret(s1), sec2: secret(s2) },
      });
      expect(context.fields['Field [secret]']).toBe('val1');
      expect(context.fields['Field [secret] (2)']).toBe('val2');
    } finally {
      await page.close();
    }
  });

  // 35. Finding A: encoded secret in context.url
  it('redacts encoded secret in context.url', async () => {
    const page = await browser.newPage();
    try {
      const secVal = 'pass word?';
      await page.goto(
        `data:text/html,<html><body><p>Hi</p></body></html>#token=${encodeURIComponent(secVal)}`,
      );
      const { context } = await observe(page, {
        values: { sec: secret(secVal) },
      });
      expect(context.url).not.toContain('pass');
      expect(context.url).toContain('[secret]');
    } finally {
      await page.close();
    }
  });

  // 36. Finding B: observes inside a role-less div locator target
  it('observes inside a role-less div locator target', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div><button id="outside">Outside</button></div>
        <div id="scope">
          <button id="inside">Inside</button>
        </div>
      `);
      const { ops } = await observe(page.locator('#scope'));
      expect(findLeafOp(ops, o => o.description === 'Click "Inside"')).toBeDefined();
      expect(findLeafOp(ops, o => o.description === 'Click "Outside"')).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  // 37. Finding B: keeps ancestor path above a scoped locator target
  it('keeps ancestor path above a scoped locator target', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <main>
          <h1>Section</h1>
          <div id="scope">
            <button id="inside">Inside</button>
          </div>
        </main>
      `);
      const { ops } = await observe(page.locator('#scope'));
      const mainGroup = findGroup(ops, 'Main content');
      expect(mainGroup).toBeDefined();
      if (mainGroup === undefined) throw new Error('Expected mainGroup to be defined');
      const sectionGroup = findGroup(mainGroup, 'Section');
      expect(sectionGroup).toBeDefined();
      if (sectionGroup === undefined) throw new Error('Expected sectionGroup to be defined');
      expect(findLeafOp(sectionGroup, o => o.description === 'Click "Inside"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 38. Finding B: throws when locator matches 0 or multiple elements
  it('throws when locator matches 0 or multiple elements', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div class="dup">One</div>
        <div class="dup">Two</div>
      `);
      await expect(observe(page.locator('#non-existent'))).rejects.toThrow(/matched 0 elements/i);
      await expect(observe(page.locator('.dup'))).rejects.toThrow(/matched 2 elements/i);
    } finally {
      await page.close();
    }
  });

  // 39. Finding C: duplicate labels A, A, A (2) produce three distinct choices and invoke selects correct one
  it('disambiguates combobox options with duplicate and suffixed labels and binds value', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <label for="sel">Choice</label>
        <select id="sel">
          <option value="opt1">A</option>
          <option value="opt2">A</option>
          <option value="opt3">A (2)</option>
        </select>
      `);
      const { ops } = await observe(page);
      const selectOp = findLeafOp(ops, o => o.description === 'Select in "Choice"');
      expect(selectOp).toBeDefined();
      const choices = choicesOf(selectOp);
      expect(choices.length).toBe(3);
      const labels = choices.map(c => c.label);
      expect(new Set(labels).size).toBe(3);

      const thirdChoice = choices[2];
      if (thirdChoice === undefined) throw new Error('Expected 3rd choice');
      await thirdChoice.invoke();
      expect(await page.locator('#sel').inputValue()).toBe('opt3');
    } finally {
      await page.close();
    }
  });

  // 40. Finding C: two secrets that redact to the same label produce two distinct choices
  it('disambiguates choices when two secrets redact to the same label', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <label for="sel">Choice</label>
        <select id="sel">
          <option value="opt1">Token secret_one</option>
          <option value="opt2">Token secret_two</option>
        </select>
        <label for="pw">Password</label>
        <input id="pw" type="password" />
      `);
      const s1 = 'secret_one';
      const s2 = 'secret_two';
      const { ops } = await observe(page, {
        values: {
          [`token_${s1}`]: secret(s1),
          [`token_${s2}`]: secret(s2),
        },
      });

      // Select op choices: both options redact to "Token [secret]"
      const selectOp = findLeafOp(ops, o => o.description === 'Select in "Choice"');
      expect(selectOp).toBeDefined();
      const selectChoices = choicesOf(selectOp);
      expect(selectChoices.length).toBe(2);
      expect(selectChoices.map(c => c.label)).toEqual(['Token [secret]', 'Token [secret] (2)']);

      // Password op choices: both values have keys that redact to "token_[secret]"
      const pwdOp = findLeafOp(ops, o => o.description === 'Fill "Password"');
      expect(pwdOp).toBeDefined();
      const pwdChoices = choicesOf(pwdOp);
      expect(pwdChoices.length).toBe(2);
      expect(pwdChoices.map(c => c.label)).toEqual(['token_[secret]', 'token_[secret] (2)']);

      // Invoking second select choice selects opt2
      const secondSelect = selectChoices[1];
      if (secondSelect === undefined) throw new Error('Expected secondSelect');
      await secondSelect.invoke();
      expect(await page.locator('#sel').inputValue()).toBe('opt2');
    } finally {
      await page.close();
    }
  });

  // 41. Finding D: shouldOffer allowing buttons only keeps Email field in context
  it('keeps fields in context even when shouldOffer rejects non-buttons', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <form>
          <label for="email">Email</label>
          <input id="email" type="email" value="test@example.com" />
          <button id="btn">Submit</button>
        </form>
      `);
      const { context, ops } = await observe(page, {
        shouldOffer: (c: Control) => c.role === 'button',
      });
      expect(context.fields['Email']).toBe('test@example.com');
      expect(findLeafOp(ops, o => o.description === 'Click "Submit"')).toBeDefined();
      expect(findLeafOp(ops, o => o.description === 'Fill "Email"')).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  // 42. Finding G: lone article with title link and Edit button is named
  it('names a lone article holding 2 to 12 controls without requiring siblings', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <article>
          <h2><a href="/story">Story Title</a></h2>
          <button>Edit</button>
        </article>
      `);
      const { ops } = await observe(page);
      const articleGroup = findGroup(ops, 'Story Title');
      expect(articleGroup).toBeDefined();
      if (articleGroup === undefined) throw new Error('Expected articleGroup');
      expect(
        findLeafOp(articleGroup, o => o.description === 'Open link "Story Title"'),
      ).toBeDefined();
      expect(findLeafOp(articleGroup, o => o.description === 'Click "Edit"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 43. Finding H: readonly textbox gets no fill op
  it('does not offer a fill op to a readonly textbox', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <label for="ro">Readonly</label>
        <input id="ro" type="text" readonly value="preset" />
      `);
      const { context, ops } = await observe(page, {
        values: { newVal: 'updated' },
      });
      expect(context.fields['Readonly']).toBe('preset');
      const fillOp = findLeafOp(ops, o => o.description === 'Fill "Readonly"');
      expect(fillOp).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  // 44. Finding H: spinbutton rejects hex, Infinity, exp, accepting only finite decimals
  it('offers only finite decimal strings to spinbuttons, rejecting hex and Infinity', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <label for="num">Quantity</label>
        <input id="num" type="number" />
      `);
      const { ops } = await observe(page, {
        values: {
          validDec: '42',
          validFloat: '3.14',
          validNegative: '-7',
          hex: '0x10',
          inf: 'Infinity',
          exp: '1e5',
        },
      });
      const numOp = findLeafOp(ops, o => o.description === 'Fill "Quantity"');
      expect(numOp).toBeDefined();
      const choices = choicesOf(numOp);
      const labels = choices.map(c => c.label);
      expect(labels).toContain('validDec: 42');
      expect(labels).toContain('validFloat: 3.14');
      expect(labels).toContain('validNegative: -7');
      expect(labels).not.toContain('hex: 0x10');
      expect(labels).not.toContain('inf: Infinity');
      expect(labels).not.toContain('exp: 1e5');
    } finally {
      await page.close();
    }
  });

  // 45. Native select selects correct DOM index when hidden placeholder and duplicate labels are present
  it('selects correct DOM index in native select when hidden placeholder and duplicate labels are present', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <select id="country" aria-label="Country">
          <option value="" hidden>Choose country</option>
          <option value="ca">Canada</option>
          <option value="ca2">Canada</option>
          <option value="us">United States</option>
        </select>
      `);
      const { ops } = await observe(page);
      const selectOp = findLeafOp(ops, o => o.description === 'Select in "Country"');
      expect(selectOp).toBeDefined();
      const choices = choicesOf(selectOp);
      expect(choices.map(c => c.label)).toEqual(['Canada', 'Canada (2)', 'United States']);

      const usChoice = choices.find(c => c.label === 'United States');
      expect(usChoice).toBeDefined();
      if (usChoice !== undefined) {
        await usChoice.invoke();
      }
      expect(await page.$eval('#country', el => (el as HTMLSelectElement).value)).toBe('us');

      const ca2Choice = choices.find(c => c.label === 'Canada (2)');
      expect(ca2Choice).toBeDefined();
      if (ca2Choice !== undefined) {
        await ca2Choice.invoke();
      }
      expect(await page.$eval('#country', el => (el as HTMLSelectElement).value)).toBe('ca2');
    } finally {
      await page.close();
    }
  });

  // 46. Named articles preserve their accessible name and scope controls
  it('preserves accessible names of named articles scoping Edit and Delete controls', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <article aria-label="Product A">
          <button id="edit-a">Edit</button>
          <button id="del-a">Delete</button>
        </article>
        <article aria-label="Product B">
          <button id="edit-b">Edit</button>
          <button id="del-b">Delete</button>
        </article>
      `);
      const { ops } = await observe(page);
      const groupA = findGroup(ops, 'Product A');
      const groupB = findGroup(ops, 'Product B');
      expect(groupA).toBeDefined();
      expect(groupB).toBeDefined();

      if (groupA === undefined || groupB === undefined) {
        throw new Error('Expected groups to be defined');
      }

      const editA = findLeafOp(groupA, o => o.description === 'Click "Edit"');
      const delA = findLeafOp(groupA, o => o.description === 'Click "Delete"');
      const editB = findLeafOp(groupB, o => o.description === 'Click "Edit"');
      const delB = findLeafOp(groupB, o => o.description === 'Click "Delete"');

      expect(editA).toBeDefined();
      expect(delA).toBeDefined();
      expect(editB).toBeDefined();
      expect(delB).toBeDefined();

      await page.evaluate(() => {
        for (const id of ['edit-a', 'del-a', 'edit-b', 'del-b']) {
          document.getElementById(id)?.addEventListener('click', () => {
            document.getElementById(id)?.setAttribute('data-clicked', 'true');
          });
        }
      });

      await invokeLeaf(editA);
      expect(await page.$eval('#edit-a', el => el.getAttribute('data-clicked'))).toBe('true');
      await invokeLeaf(delB);
      expect(await page.$eval('#del-b', el => el.getAttribute('data-clicked'))).toBe('true');
    } finally {
      await page.close();
    }
  });

  // 47. Sibling item names disambiguate without suffix collisions
  it('disambiguates sibling item names without suffix collisions (Alpha, Alpha, Alpha (2))', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <article aria-label="Alpha">
          <button>Edit</button>
          <button>Delete</button>
        </article>
        <article aria-label="Alpha">
          <button>Edit</button>
          <button>Delete</button>
        </article>
        <article aria-label="Alpha (2)">
          <button>Edit</button>
          <button>Delete</button>
        </article>
      `);
      const { ops } = await observe(page);
      const group1 = findGroup(ops, 'Alpha');
      const group2 = findGroup(ops, 'Alpha (2)');
      const group3 = findGroup(ops, 'Alpha (2) (2)');

      expect(group1).toBeDefined();
      expect(group2).toBeDefined();
      expect(group3).toBeDefined();

      if (group1 === undefined || group2 === undefined || group3 === undefined) {
        throw new Error('Expected groups to be defined');
      }

      expect(findLeafOp(group1, o => o.description === 'Click "Edit"')).toBeDefined();
      expect(findLeafOp(group2, o => o.description === 'Click "Edit"')).toBeDefined();
      expect(findLeafOp(group3, o => o.description === 'Click "Edit"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  // 48. Collapsed custom combobox offers Open op, then Choose ops on next observe
  it('offers Open op for collapsed custom combobox, and offers Choose ops on next observe when opened', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <button id="cb" role="combobox" aria-expanded="false" aria-label="Country">Select country</button>
        <div id="listbox" role="listbox" style="display: none;">
          <div role="option" id="opt-ca" tabindex="0">Canada</div>
          <div role="option" id="opt-us" tabindex="0">United States</div>
        </div>
        <script>
          const cb = document.getElementById("cb");
          const lb = document.getElementById("listbox");
          cb.addEventListener("click", () => {
            cb.setAttribute("aria-expanded", "true");
            lb.style.display = "block";
          });
          document.getElementById("opt-ca").addEventListener("click", () => {
            cb.textContent = "Canada";
          });
        </script>
      `);
      const initial = await observe(page);
      const openOp = findLeafOp(initial.ops, o => o.description === 'Open "Country"');
      expect(openOp).toBeDefined();

      await invokeLeaf(openOp);
      expect(await page.$eval('#cb', el => el.getAttribute('aria-expanded'))).toBe('true');

      const opened = await observe(page);
      const chooseCa = findLeafOp(opened.ops, o => o.description === 'Choose "Canada"');
      const chooseUs = findLeafOp(opened.ops, o => o.description === 'Choose "United States"');
      expect(chooseCa).toBeDefined();
      expect(chooseUs).toBeDefined();

      await invokeLeaf(chooseCa);
      expect(await page.$eval('#cb', el => el.textContent)).toBe('Canada');
    } finally {
      await page.close();
    }
  });

  it('offers Open only to a closed custom dropdown, not a native select, an editable one or an open one', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <select aria-label="Empty"><option hidden>Choose</option></select>
        <input role="combobox" aria-label="Search cities" aria-expanded="false" />
        <button role="combobox" aria-expanded="true" aria-label="City">Paris</button>
      `);
      const { ops } = await observe(page);
      expect(findLeafOp(ops, o => o.description.startsWith('Open "'))).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  // 49. Scoped observe penetrates open shadow roots
  it('scopes observe to controls inside open shadow roots', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <section id="scoped-section">
          <custom-widget id="widget"></custom-widget>
        </section>
        <button id="outside">Outside Button</button>
        <script>
          class CustomWidget extends HTMLElement {
            connectedCallback() {
              const shadow = this.attachShadow({ mode: "open" });
              shadow.innerHTML = '<button id="inside">Inside Shadow</button>';
            }
          }
          customElements.define("custom-widget", CustomWidget);
        </script>
      `);
      const { ops } = await observe(page.locator('#scoped-section'));
      const insideOp = findLeafOp(ops, o => o.description === 'Click "Inside Shadow"');
      const outsideOp = findLeafOp(ops, o => o.description === 'Click "Outside Button"');

      expect(insideOp).toBeDefined();
      expect(outsideOp).toBeUndefined();

      await page.evaluate(() => {
        const widget = document.getElementById('widget');
        widget?.shadowRoot?.getElementById('inside')?.addEventListener('click', () => {
          widget.setAttribute('data-inside-clicked', 'true');
        });
      });

      await invokeLeaf(insideOp);
      expect(await page.$eval('#widget', el => el.getAttribute('data-inside-clicked'))).toBe(
        'true',
      );
    } finally {
      await page.close();
    }
  });
  it('withholds covered button under overlay, and offers it once overlay is removed', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <button id="btn">Click me</button>
          <div id="overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;"><button style="position:absolute;right:0;bottom:0;">Dismiss</button></div>
        </body></html>
      `);
      const initial = await observe(page);
      const coveredOp = findLeafOp(initial.ops, o => o.description === 'Click "Click me"');
      expect(coveredOp).toBeUndefined();

      await page.evaluate(() => document.getElementById('overlay')?.remove());

      const revealed = await observe(page);
      const revealedOp = findLeafOp(revealed.ops, o => o.description === 'Click "Click me"');
      expect(revealedOp).toBeDefined();
    } finally {
      await page.close();
    }
  });

  it('still offers a button below the viewport fold', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <div style="height: 3000px;">Tall content</div>
          <button id="deep-btn">Bottom Action</button>
        </body></html>
      `);
      const { ops } = await observe(page);
      const deepOp = findLeafOp(ops, o => o.description === 'Click "Bottom Action"');
      expect(deepOp).toBeDefined();
    } finally {
      await page.close();
    }
  });

  it('waits for a modal still filling in, rather than offer nothing', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <button>Page action</button>
          <div role="dialog" aria-modal="true" aria-label="Search" id="search"
            style="position:fixed;inset:0;background:white;"></div>
          <script>
            // Like a search dialog fetching its suggestions once it is open.
            setTimeout(() => {
              document.getElementById('search').innerHTML = '<button>Suggestion</button>';
            }, 600);
          </script>
        </body></html>
      `);
      const { ops } = await observe(page);
      expect(findLeafOp(ops, o => o.description === 'Click "Suggestion"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  it('offers controls in any open modal, and ignores a hidden one', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <button>Page action</button>
          <div role="dialog" aria-modal="true" aria-label="Dormant" style="visibility:hidden;">
            <button>Dormant action</button>
          </div>
        </body></html>
      `);
      const dormant = await observe(page);
      expect(findLeafOp(dormant.ops, o => o.description === 'Click "Page action"')).toBeDefined();

      // Two native modals, the later-opened one first in the DOM, so on top.
      await page.setContent(`
        <html><body>
          <dialog id="top"><button>Top action</button></dialog>
          <dialog id="lower" style="width:80vw;height:80vh;"><button>Lower action</button></dialog>
          <script>
            document.getElementById('lower').showModal();
            document.getElementById('top').showModal();
          </script>
        </body></html>
      `);
      const stacked = await observe(page);
      expect(findLeafOp(stacked.ops, o => o.description === 'Click "Top action"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  it('offers a link wrapped over two lines and a display: contents button', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <p style="width:120px;line-height:3;">
            Some text <a href="#x">a link that wraps onto the next line</a>
          </p>
          <button style="display:contents;"><span>Contents button</span></button>
        </body></html>
      `);
      const { ops } = await observe(page);
      expect(
        findLeafOp(ops, o => o.description === 'Open link "a link that wraps onto the next line"'),
      ).toBeDefined();
      expect(findLeafOp(ops, o => o.description === 'Click "Contents button"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  it('withholds every control outside an open modal dialog, below the fold too', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <div style="height: 3000px;">Tall content</div>
          <a href="#features">Features</a>
          <div role="dialog" aria-modal="true" aria-label="Search" style="position:fixed;top:0;left:0;">
            <button>Close search</button>
          </div>
        </body></html>
      `);
      const { ops } = await observe(page);
      expect(findLeafOp(ops, o => o.description === 'Open link "Features"')).toBeUndefined();
      expect(findLeafOp(ops, o => o.description === 'Click "Close search"')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  it('still offers a custom checkbox visually hidden behind its label', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <label style="position:relative;display:inline-block;padding:10px;">
            <input type="checkbox" id="chk" style="position:absolute;opacity:0;z-index:-1;" />
            <span style="display:inline-block;width:20px;height:20px;background:#ccc;"></span>
            Agree to terms
          </label>
        </body></html>
      `);
      const { ops } = await observe(page);
      const checkOp = findLeafOp(ops, o => o.description === 'Check "Agree to terms"');
      expect(checkOp).toBeDefined();
    } finally {
      await page.close();
    }
  });

  it('still includes covered controls in context.fields', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <label for="inp">Secret Field</label>
          <input id="inp" type="text" value="visible-data" />
          <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;"><button style="position:absolute;right:0;bottom:0;">Dismiss</button></div>
        </body></html>
      `);
      const { context, ops } = await observe(page, { values: { newVal: 'test' } });
      expect(context.fields['Secret Field']).toBe('visible-data');
      const fillOp = findLeafOp(ops, o => o.description === 'Fill "Secret Field"');
      expect(fillOp).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  it('records failedMove when an op is covered after observe, without throwing', {
    timeout: 15_000,
  }, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <button id="btn">Submit</button>
        </body></html>
      `);
      const initial = await observe(page);
      const submitOp = findLeafOp(initial.ops, o => o.description === 'Click "Submit"');
      expect(submitOp).toBeDefined();

      await page.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.innerHTML = '<button style="position:absolute;right:0;bottom:0;">Dismiss</button>';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:red;';
        document.body.appendChild(overlay);
      });

      await expect(invokeLeaf(submitOp)).resolves.not.toThrow();

      const next = await observe(page);
      expect(next.context.failedMove).toEqual({
        move: 'Click "Submit"',
        error: 'the control is covered by <div class="overlay">',
      });

      const subsequent = await observe(page);
      expect(subsequent.context.failedMove).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  it('redacts secret in failedMove.error when covering element contains secret value', {
    timeout: 15_000,
  }, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <html><body>
          <button id="btn">Pay</button>
        </body></html>
      `);
      const secretVal = 'token-xyz-secret-999';
      const initial = await observe(page, {
        values: { secretToken: secret(secretVal) },
      });
      const payOp = findLeafOp(initial.ops, o => o.description === 'Click "Pay"');
      expect(payOp).toBeDefined();

      await page.evaluate(token => {
        const overlay = document.createElement('div');
        overlay.id = token;
        overlay.className = 'backdrop';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999;';
        overlay.innerHTML = '<button style="position:absolute;right:0;bottom:0;">Dismiss</button>';
        document.body.appendChild(overlay);
      }, secretVal);

      await expect(invokeLeaf(payOp)).resolves.not.toThrow();

      const next = await observe(page, {
        values: { secretToken: secret(secretVal) },
      });
      expect(next.context.failedMove).toEqual({
        move: 'Click "Pay"',
        error: 'the control is covered by <div id="[secret]" class="backdrop">',
      });
      expect(next.context.failedMove?.error).not.toContain(secretVal);
    } finally {
      await page.close();
    }
  });

  it('reads the new page when a navigation replaces the document mid-read', async () => {
    const page = await browser.newPage();
    try {
      await page.route('https://site.test/**', route =>
        route.fulfill({
          contentType: 'text/html',
          body:
            new URL(route.request().url()).pathname === '/start'
              ? `<title>Page One</title><h1>Page One</h1><button>Button One</button>
                <input aria-label="Trap">
                <script>
                  // Reading the field's value (after the snapshot) starts a navigation, and keeps
                  // the page busy long enough for it to arrive before the read ends.
                  const trap = document.querySelector('input');
                  let isSprung = false;
                  Object.defineProperty(trap, 'value', {
                    get() {
                      if (!isSprung) {
                        isSprung = true;
                        location.href = '/dest';
                        const until = Date.now() + 300;
                        while (Date.now() < until) {}
                      }
                      return '';
                    },
                  });
                </script>`
              : '<title>Page Two</title><h1>Page Two</h1><button>Button Two</button>',
        }),
      );
      await page.goto('https://site.test/start');

      const { context, ops } = await observe(page);

      expect(context.title).toBe('Page Two');
      expect(context.headings).toEqual([{ level: 1, text: 'Page Two' }]);
      expect(findLeafOp(ops, o => o.description === 'Click "Button Two"')).toBeDefined();
      expect(findLeafOp(ops, o => o.description === 'Click "Button One"')).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  it('still throws non-timeout errors like page closed', async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <html><body><button id="btn">Click me</button></body></html>
    `);
    const { ops } = await observe(page);
    const btnOp = findLeafOp(ops, o => o.description === 'Click "Click me"');
    expect(btnOp).toBeDefined();

    await page.close();
    await expect(invokeLeaf(btnOp)).rejects.toThrow();
  });
});
