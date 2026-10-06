// The moves a tick offers, as the task wrote them: ops, and groups of ops. How they are shown to
// the decision model is pick.ts's strategy, not part of this data.
import type { ListStrategy } from './list-strategy.ts';

/** One value an op may run with, by the label the model reads. */
type Choice = { label: string; invoke: () => unknown };

export type Op = { description: string } & (
  | { kind: 'leaf'; invoke: () => unknown; choices?: undefined }
  | { kind: 'leaf'; choices: readonly Choice[]; strategy?: ListStrategy; invoke?: undefined }
  | { kind: 'node'; ops: Ops }
);

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
  spec: StrategySpec & { choices: readonly string[]; invoke: (choice: string) => unknown },
): Op;
export function op<T>(
  description: string,
  spec: StrategySpec & { choices: Readonly<Record<string, T>>; invoke: (choice: T) => unknown },
): Op;
export function op<T>(
  description: string,
  body:
    | (() => unknown)
    | (StrategySpec & {
        choices: readonly T[] | Readonly<Record<string, T>>;
        invoke: (choice: T) => unknown;
      }),
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
