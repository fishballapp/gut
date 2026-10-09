// A browser task as a caller writes one: a start URL, a goal in words, and the values it knows.
// The model decides when the goal is met; the final page's text is in the result's context.
// gut run projects/gut/examples/browser.gut.ts <url> "<goal>" [name=value ...] [--secret name=value ...]
import { initGut } from '@gut.run/core';
import { type Control, observe } from '@gut.run/playwright';
import { chromium } from 'playwright';
import { parseArgs } from './browser-args.ts';

const { url, goal, values } = parseArgs(process.argv.slice(2));

const { runTask } = await initGut();
await using browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);

// Links stay on the site the task started on: an off-site page can look like the goal (Hacker
// News's FAQ task ended on Y Combinator's FAQ when its links were offered).
const site = new URL(page.url()).host;
const isOnSite = (control: Control) => {
  if (control.url === undefined) return true; // not a link
  return URL.canParse(control.url) && new URL(control.url).host === site;
};

const result = await runTask(async () => {
  const { context, ops } = await observe(page, { values, shouldOffer: isOnSite });
  return { context: { goal, page: context }, ops };
});

const finalPage = { url: page.url(), title: await page.title() };
process.stdout.write(`${JSON.stringify({ ...result, finalPage }, null, 2)}\n`);
