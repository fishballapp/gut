import type { Edit, OpTreeNode } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import { copyBackOf, copyTextOf } from './edit-copy.ts';

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

const context = { goal: 'The counter is 3', counter: 0 };

describe('copyTextOf', () => {
  it('copies a line per change, then the context as a diff', () => {
    const edits: Edit[] = [
      { kind: 'hide', address: { keys: ['more', 'reset'] } },
      { kind: 'label', keys: ['set'], choice: 1, label: 'one' },
      { kind: 'description', keys: ['add'], description: 'Add one more' },
      { kind: 'context', context: { ...context, counter: 1 } },
    ];
    expect(copyTextOf(copyBackOf(ops, context, edits))).toBe(
      [
        'hide more.reset',
        'set[1]: "1" → "one"',
        'add: "Add one" → "Add one more"',
        'context:',
        '  {',
        '    "goal": "The counter is 3",',
        '-   "counter": 0',
        '+   "counter": 1',
        '  }',
      ].join('\n'),
    );
  });

  it('leaves out the context when the edits keep it', () => {
    const edits: Edit[] = [{ kind: 'description', keys: ['add'], description: 'Add two' }];
    expect(copyBackOf(ops, context, edits)).toEqual({
      changes: ['add: "Add one" → "Add two"'],
      context: undefined,
    });
  });
});
