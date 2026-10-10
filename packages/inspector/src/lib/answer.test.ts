import { describe, expect, it } from 'vitest';
import {
  answerHint,
  isAnswerComplete,
  keycapOf,
  keyedRows,
  LIST_LIMIT,
  listView,
  type Option,
  optionsOf,
} from './answer.ts';

const options = (count: number): Option[] =>
  Array.from({ length: count }, (_, i) => ({ key: `o${i + 1}`, text: `Move ${i + 1}` }));

describe('optionsOf', () => {
  it('keeps the options in the order sent', () => {
    expect(optionsOf({ notYet: 'Not yet', achieved: 'Achieved' })).toEqual([
      { key: 'notYet', text: 'Not yet' },
      { key: 'achieved', text: 'Achieved' },
    ]);
  });
});

describe('listView', () => {
  it('shows every option of a short list', () => {
    const view = listView(options(3), '', undefined);
    expect(view).toEqual({ shown: options(3), matchCount: 3, hiddenCount: 0 });
  });

  it('shows the first nine of a long list and counts the rest', () => {
    const view = listView(options(96), '', undefined);
    expect(view.shown).toHaveLength(LIST_LIMIT);
    expect(view.shown[0]).toEqual({ key: 'o1', text: 'Move 1' });
    expect(view.hiddenCount).toBe(87);
  });

  it('narrows by key or text, ignoring case and surrounding spaces', () => {
    const view = listView(options(20), '  MOVE 1', undefined);
    expect(view.matchCount).toBe(11);
    expect(view.shown.map(option => option.key)).toEqual([
      'o1',
      'o10',
      'o11',
      'o12',
      'o13',
      'o14',
      'o15',
      'o16',
      'o17',
    ]);
  });

  it('keeps the chosen option visible while filtering, even past the nine', () => {
    const view = listView(options(20), 'move', 'o15');
    expect(view.shown).toHaveLength(LIST_LIMIT + 1);
    expect(view.shown.at(-1)).toEqual({ key: 'o15', text: 'Move 15' });
    expect(view.hiddenCount).toBe(20 - (LIST_LIMIT + 1));
  });

  it('keeps the chosen option when the filter excludes it, once and in its place', () => {
    const view = listView(options(20), 'set it to', 'o3');
    expect(view.shown).toEqual([{ key: 'o3', text: 'Move 3' }]);
    expect(view.matchCount).toBe(0);
    expect(view.hiddenCount).toBe(0);
  });

  it('shows the chosen option once when the filter matches it too', () => {
    const view = listView(options(3), 'move', 'o2');
    expect(view.shown.map(option => option.key)).toEqual(['o1', 'o2', 'o3']);
    expect(view.matchCount).toBe(3);
  });
});

describe('keycapOf', () => {
  it('takes G and N on the goal question only', () => {
    expect(keycapOf('achieved', 'achieved', 0)).toBe('G');
    expect(keycapOf('achieved', 'notYet', 1)).toBe('N');
  });

  it('numbers the first nine shown options of any other question', () => {
    expect(keycapOf('next', 'o1', 0)).toBe('1');
    expect(keycapOf('next', 'o9', 8)).toBe('9');
    expect(keycapOf('next', 'o10', 9)).toBeUndefined();
  });
});

describe('keyedRows', () => {
  it('pairs each key with the option it picks, per question', () => {
    const rows = keyedRows([
      { questionKey: 'achieved', shown: optionsOf({ achieved: 'yes', notYet: 'no' }) },
      { questionKey: 'next', shown: options(2) },
    ]);
    expect(rows).toEqual([
      { keycap: 'G', questionKey: 'achieved', optionKey: 'achieved' },
      { keycap: 'N', questionKey: 'achieved', optionKey: 'notYet' },
      { keycap: '1', questionKey: 'next', optionKey: 'o1' },
      { keycap: '2', questionKey: 'next', optionKey: 'o2' },
    ]);
  });
});

describe('isAnswerComplete', () => {
  it('needs a choice for every question', () => {
    expect(isAnswerComplete(['achieved', 'next'], { achieved: 'notYet' })).toBe(false);
    expect(isAnswerComplete(['achieved', 'next'], { achieved: 'notYet', next: 'o1' })).toBe(true);
  });
});

describe('answerHint', () => {
  it('names the model that can answer', () => {
    expect(answerHint({ name: 'Jev' })).toBe(
      'Choose one option per question, or let Jev answer this turn.',
    );
  });

  it('says why the model cannot answer when there is none', () => {
    expect(answerHint(null)).toBe(
      'Choose one option per question. Ask model needs a model: add one.',
    );
  });
});
