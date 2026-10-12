import { cn } from '@fishballapps/cn';
import type { Action } from '@gut.run/core/inspector';
import { motion } from 'motion/react';
import { useState } from 'react';
import { type ActOutcome, type ConnectionStatus, isReplay } from '../lib/connection.ts';
import { canPickAgainFrom } from '../lib/pick-again.ts';
import { findAwaitingTurn, findRoundDecision, findWaitingStep } from '../lib/round-rows.ts';
import type { Selected } from '../lib/selection.ts';
import type { OptionSort } from '../lib/sort-options.ts';
import { stepCall } from '../lib/step-call.ts';
import { defaultSortFor, formatRetry, optionsPhaseOf } from '../lib/turn-display.ts';
import type { Decision, InspectorState, Round, Run, Turn } from '../state/inspector-state.ts';
import { TurnEndings } from './endings/TurnEndings.tsx';
import { PickAgainFromTurn } from './turn/PickAgainFromTurn.tsx';
import { SortToggle } from './turn/SortToggle.tsx';
import { StepActions } from './turn/StepActions.tsx';
import { TurnHeader, TurnStatus } from './turn/TurnHeader.tsx';
import { TurnOptions } from './turn/TurnOptions.tsx';

/**
 * The selected turn: what was asked and how it was answered, or what waits for an answer. A pick
 * waiting to run is confirmed under the round's last turn; a turn before the one the round waits on
 * can be picked again from, after which the page follows the run again.
 */
export const TurnView = ({
  state,
  selected,
  status,
  act,
  follow,
}: {
  state: InspectorState;
  selected: Selected;
  status: ConnectionStatus;
  act: (action: Action) => Promise<ActOutcome>;
  follow: () => void;
}) => {
  const { run, round, turn } = selected;
  const stepDecision =
    run !== undefined && round !== undefined
      ? findWaitingStep(state.pending, run.runId, round.round)
      : undefined;
  const stepWaiting =
    stepDecision !== undefined && round?.picked !== undefined ? stepDecision : undefined;
  return (
    <motion.main
      layoutScroll
      className={cn(
        'relative overflow-auto border-t border-line px-5 py-6 lg:border-t-0 lg:px-8',
        isReplay && 'max-lg:border-t-0',
      )}
    >
      <TurnEndings state={state} selected={selected} status={status} />
      {state.incompatible !== undefined && (
        <p role="alert" className="rounded-lg border border-you p-4 text-you">
          This page speaks inspector protocol {state.incompatible.page}, and this gut speaks{' '}
          {state.incompatible.cli}. Build the page from the same gut version as the CLI.
        </p>
      )}
      {round !== undefined && (
        <div className="mx-auto max-w-3xl">
          {turn !== undefined ? (
            <SelectedTurn
              key={`${run?.runId ?? ''}:${round.round}:${turn.turn}`}
              state={state}
              run={run}
              round={round}
              turn={turn}
              stepWaiting={stepWaiting}
              act={act}
              follow={follow}
            />
          ) : (
            stepWaiting !== undefined &&
            round.picked !== undefined && (
              <StepActions
                round={round.round}
                decision={stepWaiting}
                pickedCall={stepCall(round, round.picked)}
                act={act}
              />
            )
          )}
        </div>
      )}
    </motion.main>
  );
};

/**
 * One turn and its sort. Keyed by run, round and turn at the call site, so the sort you chose
 * resets whenever the selection moves, even back to the same turn.
 */
const SelectedTurn = ({
  state,
  run,
  round,
  turn,
  stepWaiting,
  act,
  follow,
}: {
  state: InspectorState;
  run: Run | undefined;
  round: Round;
  turn: Turn;
  stepWaiting: Decision | undefined;
  act: (action: Action) => Promise<ActOutcome>;
  follow: () => void;
}) => {
  // Unset until you choose: the turn's default, which follows the model's answer when it comes.
  const [chosenSort, setChosenSort] = useState<OptionSort>();
  const sort = chosenSort ?? defaultSortFor(turn);
  const awaitingDecision =
    run !== undefined
      ? findAwaitingTurn(state.pending, run.runId, round.round, turn.turn)
      : undefined;
  const isAwaitingYou = awaitingDecision !== undefined;
  const isChoosing = optionsPhaseOf(turn, awaitingDecision) === 'choose';
  const lastTurn = round.turns.at(-1)?.turn ?? turn.turn;
  const isLastTurn = lastTurn === turn.turn;
  const roundDecision =
    run !== undefined ? findRoundDecision(state.pending, run.runId, round.round) : undefined;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <TurnHeader round={round} turn={turn} isAwaitingYou={isAwaitingYou} />
        <div className="flex shrink-0 flex-col items-end gap-2">
          <TurnStatus turn={turn} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {roundDecision !== undefined && canPickAgainFrom(turn.turn, roundDecision) && (
              <PickAgainFromTurn
                turn={turn.turn}
                lastTurn={lastTurn}
                decision={roundDecision}
                act={act}
                onPicked={follow}
              />
            )}
            {/* Reserved while you choose, so the header keeps its height as the model takes the turn. */}
            <div className={isChoosing ? 'invisible' : undefined}>
              <SortToggle value={sort} onChange={setChosenSort} />
            </div>
          </div>
        </div>
      </div>

      {turn.retries.length > 0 && (
        <ul className="mt-4 space-y-1">
          {turn.retries.map((retry, i) => (
            <li key={`${retry.delayMs}-${i}`} className="font-mono text-xs text-muted">
              {formatRetry(retry)}
            </li>
          ))}
        </ul>
      )}

      {turn.outcome.status === 'failed' && (
        <p role="alert" className="mt-4 font-mono text-sm text-you">
          {turn.outcome.error}
          {turn.outcome.isTooLarge && (
            <span className="mt-1 block">too large: split and asked again</span>
          )}
        </p>
      )}

      {turn.outcome.status === 'dropped' && (
        <p className="mt-4 font-mono text-sm text-muted">
          Dropped: the budget ran out before the model was asked.
        </p>
      )}

      {/* Keyed by the pick, not the decision: a re-pick starts afresh, and sending Ask model keeps your choice. */}
      <TurnOptions
        key={round.picks.length}
        turn={turn}
        decision={awaitingDecision}
        model={run?.model ?? state.pageModel}
        sort={sort}
        act={act}
      />

      {stepWaiting !== undefined && isLastTurn && (
        <StepActions round={round.round} decision={stepWaiting} act={act} />
      )}
    </>
  );
};
