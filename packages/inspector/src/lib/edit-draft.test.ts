import type { Edit, OpTreeNode } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import {
  type Context,
  contextOf,
  contextProblemOf,
  draftOf,
  editsOf,
  withContext,
  withHidden,
  withText,
} from './edit-draft.ts';

const ops: OpTreeNode[] = [
  {
    kind: 'group',
    address: { keys: ['more'] },
    description: 'More moves',
    children: [{ kind: 'op', address: { keys: ['more', 'reset'] }, description: 'Reset to zero' }],
  },
  {
    kind: 'choices',
    address: { keys: ['set'] },
    description: 'Set it to',
    children: [
      { kind: 'choice', address: { keys: ['set'], choice: 0 }, label: '0' },
      { kind: 'choice', address: { keys: ['set'], choice: 1 }, label: '1' },
    ],
  },
  { kind: 'op', address: { keys: ['add'] }, description: 'Add one' },
];

const context: Context = { goal: 'The counter is 3', counter: 0 };
const clean = draftOf([], context);

describe('editsOf', () => {
  it('sends nothing for a draft the task wrote', () => {
    expect(editsOf(ops, context, clean)).toEqual([]);
  });

  it('sends nothing for a text set back to what the task wrote', () => {
    const draft = withText(clean, { keys: ['add'] }, 'Add one');
    expect(editsOf(ops, context, draft)).toEqual([]);
  });

  it('sends each text, label and hidden move in the order of the op tree', () => {
    const draft = [
      (d: ReturnType<typeof draftOf>) => withHidden(d, { keys: ['more', 'reset'] }, true),
      (d: ReturnType<typeof draftOf>) => withText(d, { keys: ['set'], choice: 1 }, 'one'),
      (d: ReturnType<typeof draftOf>) => withText(d, { keys: ['add'] }, 'Add one more'),
    ].reduce((d: ReturnType<typeof draftOf>, change) => change(d), clean);
    expect(editsOf(ops, context, draft)).toEqual([
      { kind: 'hide', address: { keys: ['more', 'reset'] } },
      { kind: 'label', keys: ['set'], choice: 1, label: 'one' },
      { kind: 'description', keys: ['add'], description: 'Add one more' },
    ]);
  });

  it('reads back the edits a draft was started from', () => {
    const edits: Edit[] = [
      { kind: 'hide', address: { keys: ['more', 'reset'] } },
      { kind: 'label', keys: ['set'], choice: 1, label: 'one' },
      { kind: 'description', keys: ['add'], description: 'Add one more' },
      { kind: 'context', context: { ...context, counter: 1 } },
    ];
    expect(editsOf(ops, context, draftOf(edits, context))).toEqual(edits);
  });

  it('sends a context that changed, and not one left as the task wrote it', () => {
    const changed = withContext(clean, JSON.stringify({ ...context, counter: 2 }, null, 2));
    expect(editsOf(ops, context, changed)).toEqual([
      { kind: 'context', context: { ...context, counter: 2 } },
    ]);
    expect(editsOf(ops, context, withContext(clean, JSON.stringify(context, null, 2)))).toEqual([]);
  });

  it('sends no context while its text does not read as one', () => {
    const draft = withContext(withText(clean, { keys: ['add'] }, 'Add two'), '{"counter": 2');
    expect(editsOf(ops, context, draft)).toEqual([
      { kind: 'description', keys: ['add'], description: 'Add two' },
    ]);
  });
});

describe('contextOf', () => {
  it('reads an object with a string goal', () => {
    expect(contextOf('{"goal": "done", "n": 1}')).toEqual({
      context: { goal: 'done', n: 1 },
    });
  });

  it('says what is wrong with text that is not JSON', () => {
    expect(contextProblemOf(withContext(clean, '{"goal": '))).toMatch(/^Not valid JSON:/);
  });

  it('says a context without a string goal is wrong, naming the goal', () => {
    expect(contextProblemOf(withContext(clean, '{"counter": 1}'))).toContain('goal');
    expect(contextProblemOf(withContext(clean, '{"goal": 3}'))).toContain('goal');
  });

  it('is no problem for a context object', () => {
    expect(contextProblemOf(clean)).toBeUndefined();
  });
});
