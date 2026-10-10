import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RunEventSchema, toOpTree } from './events.ts';
import { group, op } from './ops.ts';

describe('toOpTree', () => {
  it('builds nodes from the ops as written, skipping falsy entries', () => {
    expect(
      toOpTree({
        go: op('Go', () => {}),
        skip: false,
        nested: group('Nested', {
          a: op('A', () => {}),
          b: op('Pick', {
            choices: ['x', 'y'],
            invoke: () => {},
          }),
        }),
      }),
    ).toEqual([
      {
        kind: 'op',
        address: { keys: ['go'] },
        description: 'Go',
      },
      {
        kind: 'group',
        address: { keys: ['nested'] },
        description: 'Nested',
        children: [
          {
            kind: 'op',
            address: { keys: ['nested', 'a'] },
            description: 'A',
          },
          {
            kind: 'choices',
            address: { keys: ['nested', 'b'] },
            description: 'Pick',
            children: [
              { kind: 'choice', address: { keys: ['nested', 'b'], choice: 0 }, label: 'x' },
              { kind: 'choice', address: { keys: ['nested', 'b'], choice: 1 }, label: 'y' },
            ],
          },
        ],
      },
    ]);
  });
});

describe('RunEventSchema', () => {
  // Bump PROTOCOL if older readers would break on this schema change.
  it('toJSONSchema snapshot — bump PROTOCOL if older readers would break', () => {
    expect(z.toJSONSchema(RunEventSchema)).toMatchSnapshot();
  });
});
