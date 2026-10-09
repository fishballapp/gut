// How a list longer than one question takes is chosen from: `ListStrategy.bundle` (the default) or
// `ListStrategy.knockout`, picked per op. A strategy breaks the list into questions of at most
// `maxOptions` options (the decision model's limit, `capabilities.choiceQuestions.maxOptions` in
// gut.config.json) and asks them through `ask`, which runs one question and returns the option the
// model chose; the goal, the budget and the logging all live behind `ask`.

type Described = { description: string };

/** How the decision model is asked: one question at a time, of 1 to `maxOptions` options. */
export type Questions = {
  maxOptions: number;
  ask: <T extends Described>(options: readonly T[]) => Promise<T>;
};

/** How a list of any length is chosen from, one question at a time. */
export type ListStrategy = <T extends Described>(
  options: readonly T[],
  questions: Questions,
) => Promise<T>;

const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

/**
 * A bundle's option: "Contains:", then each item it holds on lines of its own, indented under it,
 * so an item that is itself an outline (a closed group's preview) keeps its shape.
 */
const bundleDescription = (items: readonly Described[]) =>
  [
    'Contains:',
    ...items.flatMap(item => item.description.split('\n').map(line => `  ${line}`)),
  ].join('\n');

/**
 * The list is cut into at most `maxOptions` bundles that each list everything they hold
 * (`bundleDescription`); the model picks a bundle, then picks within it. Every option costs framing
 * tokens, so a bundle of 26 titles costs far less than 26 options.
 */
const bundle: ListStrategy = async (options, questions) => {
  if (options.length <= questions.maxOptions) return questions.ask(options);
  const size = Math.ceil(options.length / questions.maxOptions);
  const chosen = await questions.ask(
    chunk(options, size).map(items => ({
      description: bundleDescription(items),
      items,
    })),
  );
  return bundle(chosen.items, questions);
};

/**
 * The list is cut into pages of `pageSize` (2 to `maxOptions`), each page picks its winner, and the
 * winners are asked again until one is left.
 */
export const knockoutInPagesOf =
  (pageSize: number): ListStrategy =>
  async (options, questions) => {
    if (options.length <= pageSize) return questions.ask(options);
    const winners = await Array.fromAsync(chunk(options, pageSize), page => questions.ask(page));
    return knockoutInPagesOf(pageSize)(winners, questions);
  };

export const ListStrategy = {
  bundle,
  /** Every option as itself, in pages of `maxOptions`, then the page winners. */
  knockout: (options, questions) => knockoutInPagesOf(questions.maxOptions)(options, questions),
} satisfies Record<string, ListStrategy>;
