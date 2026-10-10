// The answer form's rules: which options a question shows, the key that picks each, and when an
// answer is complete. The goal question takes G and N; every other question takes 1 to 9.

export const GOAL_QUESTION_KEY = 'achieved';

/** A question longer than this shows its first nine options and a filter. */
export const LIST_LIMIT = 9;

const GOAL_KEYCAPS: Readonly<Record<string, string>> = { achieved: 'G', notYet: 'N' };

export type Option = { key: string; text: string };

export type ListView = { shown: Option[]; matchCount: number; hiddenCount: number };

export const optionsOf = (criteria: Readonly<Record<string, string>>): Option[] =>
  Object.entries(criteria).map(([key, text]) => ({ key, text }));

/**
 * The options a question shows: the first nine that match the filter, plus the chosen one whatever
 * the filter says, so a choice never disappears while filtering.
 */
export const listView = (
  options: readonly Option[],
  query: string,
  chosen: string | undefined,
): ListView => {
  const needle = query.trim().toLowerCase();
  const matches = options.filter(
    option => needle === '' || `${option.key} ${option.text}`.toLowerCase().includes(needle),
  );
  const shownKeys = new Set(matches.slice(0, LIST_LIMIT).map(option => option.key));
  if (chosen !== undefined) shownKeys.add(chosen);
  const shown = options.filter(option => shownKeys.has(option.key));
  const hiddenCount = matches.filter(option => !shownKeys.has(option.key)).length;
  return { shown, matchCount: matches.length, hiddenCount };
};

/** The key that picks an option shown at `index`: G or N on the goal question, 1 to 9 on the others. */
export const keycapOf = (
  questionKey: string,
  optionKey: string,
  index: number,
): string | undefined => {
  if (questionKey === GOAL_QUESTION_KEY) return GOAL_KEYCAPS[optionKey];
  return index < LIST_LIMIT ? String(index + 1) : undefined;
};

export type KeyedRow = { keycap: string; questionKey: string; optionKey: string };

/** Every option shown that a key picks, across the questions of a turn. */
export const keyedRows = (
  lists: readonly { questionKey: string; shown: readonly Option[] }[],
): KeyedRow[] =>
  lists.flatMap(({ questionKey, shown }) =>
    shown.flatMap((option, index) => {
      const keycap = keycapOf(questionKey, option.key, index);
      return keycap === undefined ? [] : [{ keycap, questionKey, optionKey: option.key }];
    }),
  );

export const isAnswerComplete = (
  questionKeys: readonly string[],
  choices: Readonly<Record<string, string>>,
): boolean => questionKeys.every(questionKey => choices[questionKey] !== undefined);

/** The muted line under the answer buttons: who else can answer, or why nobody can. */
export const answerHint = (model: { name: string } | null): string => {
  if (model === null) return 'Choose one option per question. Ask model needs a model: add one.';
  return `Choose one option per question, or let ${model.name} answer this turn.`;
};
