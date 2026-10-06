// The Wikipedia race: reach one article from another by following links only.
// gut run projects/gut/examples/wikirace.gut.ts [from=Banana] [to="Roman Empire"]
import { op, task } from '@gut.run/core';
import { readArticle } from './wikipedia.ts';

const [from = 'Banana', target = 'Roman Empire'] = process.argv.slice(2);
const path = [from]; // the articles visited, by their real titles; the model doesn't need them

await task(async () => {
  const article = await readArticle(path.at(-1) ?? from);
  // A link can name a redirect ("Chaturaṅga" for "Chaturanga"), so keep the article's real title,
  // or a later link with that title opens it again.
  // ponytail: a second redirect name for a visited article still slips through; resolve every link
  // (50 titles per Wikipedia query) if revisits show up in runs.
  path.splice(-1, 1, article.title);

  return {
    context: {
      system:
        'You are helping the user decide the next step for their wiki race by picking the most relevant link to click to reach their goal',
      goal: `The current article is "${target}"`,
      currentArticle: article.title,
    },

    ops: [
      op({
        id: 'openLink',
        description: 'Open a link on the current article',
        choices: article.links.filter(link => !path.includes(link)),
        invoke: link => {
          path.push(link);
        },
      }),
    ],
  };
});
