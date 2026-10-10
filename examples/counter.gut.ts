// The smallest task: count to a target. It needs no network, so it is the one to try the inspector
// on, answering every turn yourself: gut run projects/gut/examples/counter.gut.ts --inspect
import { group, initGut, op } from '@gut.run/core';

const target = Number(process.argv[2] ?? 3);
const counter = { value: 0 };

const { runTask } = await initGut();

await runTask(
  `Count to ${target}`,
  async () => ({
    context: {
      instruction: 'Pick the move that brings the counter to the target',
      goal: `The counter is ${target}`,
      counter: counter.value,
    },
    ops: {
      add: op('Add one', () => {
        counter.value += 1;
      }),
      subtract: op('Subtract one', () => {
        counter.value -= 1;
      }),
      more: group('More moves', {
        double: op('Double it', () => {
          counter.value *= 2;
        }),
        reset: op('Reset to zero', () => {
          counter.value = 0;
        }),
        set: op('Set it to', {
          choices: Array.from({ length: 10 }, (_, i) => String(i)),
          invoke: choice => {
            counter.value = Number(choice);
          },
        }),
      }),
    },
  }),
  { isGoalAchieved: () => counter.value === target },
);
