import type { OpTreeNode } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import { pickedOp } from './round-title.ts';

const ops: OpTreeNode[] = [
  {
    kind: 'choices',
    address: { keys: ['openLink'] },
    description: 'Open a link',
    children: [
      { kind: 'choice', address: { keys: ['openLink'], choice: 0 }, label: 'Banana' },
      { kind: 'choice', address: { keys: ['openLink'], choice: 1 }, label: 'Domestication' },
    ],
  },
  {
    kind: 'group',
    address: { keys: ['more'] },
    description: 'More moves',
    children: [
      { kind: 'op', address: { keys: ['more', 'reset'] }, description: 'Reset to zero' },
      {
        kind: 'choices',
        address: { keys: ['more', 'set'] },
        description: 'Set it',
        children: [{ kind: 'choice', address: { keys: ['more', 'set'], choice: 3 }, label: '3' }],
      },
    ],
  },
  { kind: 'op', address: { keys: ['add'] }, description: 'Add one' },
];

describe('pickedOp', () => {
  it('reads a choice as its list keys and its label, described by the list and the label', () => {
    expect(pickedOp(ops, { keys: ['openLink'], choice: 1 })).toEqual({
      title: { kind: 'choice', keys: ['openLink'], label: 'Domestication' },
      move: 'Open a link › Domestication',
      description: 'Open a link › Domestication',
    });
  });

  it('reads a choice under a group with the group keys in its prefix', () => {
    expect(pickedOp(ops, { keys: ['more', 'set'], choice: 3 })).toEqual({
      title: { kind: 'choice', keys: ['more', 'set'], label: '3' },
      move: 'Set it › 3',
      description: 'More moves › Set it › 3',
    });
  });

  it('reads a plain op at the top as its key, described by itself alone', () => {
    expect(pickedOp(ops, { keys: ['add'] })).toEqual({
      title: { kind: 'op', prefix: [], key: 'add' },
      move: 'Add one',
      description: 'Add one',
    });
  });

  it('reads a plain op in a group as the group keys, described by its group and itself', () => {
    expect(pickedOp(ops, { keys: ['more', 'reset'] })).toEqual({
      title: { kind: 'op', prefix: ['more'], key: 'reset' },
      move: 'Reset to zero',
      description: 'More moves › Reset to zero',
    });
  });

  it('returns null for an address the tree does not hold', () => {
    expect(pickedOp(ops, { keys: ['openLink'], choice: 99 })).toBeNull();
    expect(pickedOp(ops, { keys: ['more'] })).toBeNull();
  });

  it('does not match a plain op to a choice list with the same keys', () => {
    expect(pickedOp(ops, { keys: ['openLink'] })).toBeNull();
  });
});
