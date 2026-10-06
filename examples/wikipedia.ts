// Reads a Wikipedia article's title and the articles it links to, in page order.
import { z } from 'zod';

const ParseSchema = z.object({ parse: z.object({ title: z.string(), text: z.string() }) });

// Sections whose links lead to sources rather than related articles.
const SOURCE_SECTIONS =
  /^(references|notes|external links|further reading|bibliography|sources|citations|footnotes|works cited)$/i;

export type Article = { title: string; links: string[] };

export const readArticle = async (title: string): Promise<Article> => {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'parse',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    prop: 'text',
    page: title,
  }).toString();
  const response = await fetch(url, {
    headers: { 'user-agent': 'gut.run examples (https://gut.run)' },
  });
  if (!response.ok) throw new Error(`Wikipedia answered ${response.status} for "${title}"`);
  const { parse } = ParseSchema.parse(await response.json());

  const links = parse.text
    .split(/<h2[^>]*>/)
    .filter((section, i) => {
      const heading = (section.split('</h2>')[0] ?? '').replace(/<[^>]+>/g, '').trim();
      return i === 0 || !SOURCE_SECTIONS.test(heading);
    })
    .flatMap(section => [...section.matchAll(/<a href="\/wiki\/[^"#?:]+"[^>]*title="([^"]+)"/g)])
    .map(([, linked = '']) =>
      linked.replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"'),
    );
  return { title: parse.title, links: [...new Set(links)].filter(link => link !== parse.title) };
};
