// Hooks an inspector attaches to a run: who answers each turn, and the event stream.
import type { DecisionModel, DecisionRequest } from './decision-model.ts';
import {
  type OpAddress,
  type OpChoiceNode,
  type OpTreeNode,
  PROTOCOL,
  type RunEvent,
  RunEventSchema,
} from './events.ts';

export type { OpAddress, OpChoiceNode, OpTreeNode, RunEvent };
export { PROTOCOL, RunEventSchema };

/** Symbol the CLI sets on `globalThis` before importing a task; `initGut` reads it once. */
export const INSPECTOR_KEY = Symbol.for('gut.run.inspector');

/**
 * Who answers one turn: the model (the run's, or one supplied here), the developer with answers
 * keyed by question → criterion, or a re-pick of this round.
 */
export type TurnAnswer =
  | { by: 'model'; model?: DecisionModel }
  | { by: 'you'; answers: Readonly<Record<string, string>> }
  | { repick: true };

/** Hooks an inspector returns for one run. Tagged values only; never throw across this boundary. */
export type RunHooks = {
  /** Synchronous, never awaited. */
  onEvent: (event: RunEvent) => void;
  answer: (turn: { round: number; turn: number; request: DecisionRequest }) => Promise<TurnAnswer>;
  beforePick: (round: { round: number }) => Promise<{ maxOptions: number }>;
  beforeInvoke: (step: { round: number; step: string }) => Promise<'invoke' | 'repick'>;
};

/** What `globalThis[INSPECTOR_KEY]` holds when an inspector is attached. */
export type InspectorGlobal = {
  protocol: number;
  attach: (run: { runId: string }) => RunHooks;
};
