// The moves a tick offers, as the task wrote them: ops, and groups of ops. How they are shown to
// the decision model is pick.ts's strategy, not part of this data.
import type { ExclusifyUnion, Merge } from 'type-fest';
import type { ListStrategy } from './list-strategy.ts';

/** One value an op may run with, by the label the model reads. */
type Choice = { label: string; invoke: () => unknown };

/** A move: run as it is, or with one of its choices. */
type Leaf = ExclusifyUnion<
  | { kind: 'leaf'; invoke: () => unknown }
  | { kind: 'leaf'; choices: readonly Choice[]; strategy?: ListStrategy }
>;

export type Op = Merge<{ description: string }, Leaf | { kind: 'node'; ops: Ops }>;

/** What a tick's `ops` may hold: falsy entries are skipped, so `key: cond && op(…)` is a conditional op. */
export type OpEntry = Op | false | null | undefined;

/** A tick's or a group's ops, each named by its key; the model is offered them in key order. */
export type Ops = Readonly<Record<string, OpEntry>>;

export const isOp = (entry: OpEntry): entry is Op =>
  entry !== false && entry !== null && entry !== undefined;

/** How an op's choices are asked when they don't fit one question; `ListStrategy.bundle` if unset. */
type StrategySpec = { strategy?: ListStrategy };

export function op(description: string, invoke: () => unknown): Op;
export function op(
  description: string,
  spec: Merge<StrategySpec, { choices: readonly string[]; invoke: (choice: string) => unknown }>,
): Op;
export function op<T>(
  description: string,
  spec: Merge<
    StrategySpec,
    { choices: Readonly<Record<string, T>>; invoke: (choice: T) => unknown }
  >,
): Op;
export function op<T>(
  description: string,
  body:
    | (() => unknown)
    | Merge<
        StrategySpec,
        { choices: readonly T[] | Readonly<Record<string, T>>; invoke: (choice: T) => unknown }
      >,
): Op {
  if (typeof body === 'function') {
    return { kind: 'leaf', description, invoke: () => body() };
  }
  const { choices, strategy, invoke } = body;
  const entries: [string, T][] = Array.isArray(choices)
    ? choices.map((value: T) => [String(value), value])
    : Object.entries(choices);
  return {
    kind: 'leaf',
    description,
    choices: entries.map(([label, value]) => ({ label, invoke: () => invoke(value) })),
    strategy,
  };
}

export const group = (description: string, ops: Ops): Op => ({
  kind: 'node',
  description,
  ops,
});
