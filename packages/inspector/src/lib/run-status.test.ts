import { describe, expect, it } from 'vitest';
import { type InspectorState, initialState, type Run } from '../state/inspector-state.ts';
import { runStatus } from './run-status.ts';

const baseRun = (overrides: Partial<Run> = {}): Run => ({
  runId: 'r1',
  name: 'Count to 3',
  model: {
    name: 'clef-flash',
    endpoint: 'http://localhost:11434/v1/systemone',
    maxOptions: 26,
  },
  inputTokenBudget: 50_000,
  isGoalCheckedInCode: true,
  rounds: [
    {
      round: 2,
      context: { goal: 'The counter is 3' },
      ops: [],
      picks: [],
      turns: [],
    },
  ],
  ...overrides,
});

const stateOf = (overrides: Partial<InspectorState> = {}): InspectorState => ({
  ...initialState,
  task: 'counter.gut.ts',
  ...overrides,
});

describe('runStatus', () => {
  it('names a protocol mismatch first', () => {
    expect(runStatus(stateOf({ incompatible: { cli: 2, page: 1 } }), baseRun(), 'open')).toEqual({
      label: 'Protocol mismatch',
    });
  });

  it('shows Your turn for a pending turn on this run', () => {
    expect(
      runStatus(
        stateOf({
          pending: [{ id: 'd1', runId: 'r1', round: 3, on: { kind: 'turn', turn: 1 } }],
        }),
        baseRun(),
        'open',
      ),
    ).toEqual({ label: 'Your turn · round 3', dot: 'you' });
  });

  it('shows Before the step for a pending step on this run', () => {
    expect(
      runStatus(
        stateOf({
          pending: [{ id: 'd1', runId: 'r1', round: 1, on: { kind: 'step', step: 'add' } }],
        }),
        baseRun(),
        'open',
      ),
    ).toEqual({ label: 'Before the step · round 1', dot: 'you' });
  });

  it('ignores a pending decision for another run', () => {
    expect(
      runStatus(
        stateOf({
          mode: 'step',
          pending: [{ id: 'd1', runId: 'other', round: 1, on: { kind: 'turn', turn: 1 } }],
        }),
        baseRun(),
        'open',
      ),
    ).toEqual({ label: 'Paused · round 2' });
  });

  it('shows Achieved when the run ended that way', () => {
    expect(
      runStatus(
        stateOf(),
        baseRun({
          result: {
            status: 'achieved',
            steps: ['add'],
            context: { goal: 'g' },
            usage: { inputTokens: 0, requests: 0 },
          },
        }),
        'open',
      ),
    ).toEqual({ label: 'Achieved' });
  });

  it.each([
    ['stalled', 'Halted · stalled'],
    ['budget', 'Halted · budget'],
    ['noOptions', 'Halted · nothing to pick'],
    ['error', 'Halted · error'],
  ] as const)('shows Halted · %s', (reason, label) => {
    expect(
      runStatus(
        stateOf(),
        baseRun({
          result:
            reason === 'error'
              ? {
                  status: 'halted',
                  reason: 'error',
                  error: 'boom',
                  steps: [],
                  context: null,
                  usage: { inputTokens: 0, requests: 0 },
                }
              : {
                  status: 'halted',
                  reason,
                  steps: [],
                  context: null,
                  usage: { inputTokens: 0, requests: 0 },
                },
        }),
        'open',
      ),
    ).toEqual({ label, dot: 'you' });
  });

  it('shows Playing with the latest round', () => {
    expect(runStatus(stateOf({ mode: 'play' }), baseRun(), 'open')).toEqual({
      label: 'Playing · round 2',
      dot: 'ok',
    });
  });

  it('shows Paused with the latest round in Step', () => {
    expect(runStatus(stateOf({ mode: 'step' }), baseRun(), 'open')).toEqual({
      label: 'Paused · round 2',
    });
  });

  it('shows Starting before any run', () => {
    expect(runStatus(stateOf(), undefined, 'open')).toEqual({ label: 'Starting' });
    expect(runStatus(stateOf(), undefined, 'connecting')).toEqual({ label: 'Starting' });
  });

  it('shows Reconnecting when the connection is lost, even mid-run', () => {
    expect(runStatus(stateOf(), undefined, 'lost')).toEqual({ label: 'Reconnecting…' });
    expect(runStatus(stateOf({ mode: 'play' }), baseRun(), 'lost')).toEqual({
      label: 'Reconnecting…',
    });
  });

  it('keeps a protocol mismatch above a lost connection', () => {
    expect(runStatus(stateOf({ incompatible: { cli: 2, page: 1 } }), baseRun(), 'lost')).toEqual({
      label: 'Protocol mismatch',
    });
  });
});
