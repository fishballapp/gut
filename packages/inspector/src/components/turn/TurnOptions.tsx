import { Button } from '@base-ui/react/button';
import type { Action, ModelInfo } from '@gut.run/core/inspector';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { choicesOf, isAnswerComplete, keyedRows, listView, type Option } from '../../lib/answer.ts';
import type { ActOutcome } from '../../lib/connection.ts';
import { isPageKey } from '../../lib/key-target.ts';
import { type OptionSort, sortOptions } from '../../lib/sort-options.ts';
import {
  chosenKey,
  isAnsweredByYou,
  optionRowsOf,
  optionsPhaseOf,
  showsProbabilities,
} from '../../lib/turn-display.ts';
import { useAction } from '../../lib/use-action.ts';
import type { Decision, Turn } from '../../state/inspector-state.ts';
import { Keycap } from '../run/Keycap.tsx';
import { actionClass } from '../run/RunControls.tsx';
import { QuestionOptions } from './QuestionOptions.tsx';

/** Your choices, with the decision they answer: a new decision (the turn reopened) starts afresh. */
type Picked = { decision: string | undefined; choices: Readonly<Record<string, string>> };

/**
 * The options of the selected turn, in the phase it is in. While you choose, the answer buttons sit
 * under the questions; while the model answers, a spinner sits where they were. Once it has
 * answered, its choices are shown fixed: ↵ confirms them, and Pick again (R) drops them for you to
 * choose afresh. The parent keys it by the pick, so a choice never carries over to another pick.
 */
export const TurnOptions = ({
  turn,
  decision,
  model,
  sort,
  act,
}: {
  turn: Turn;
  decision: Decision | undefined;
  model: ModelInfo | null;
  sort: OptionSort;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  const phase = optionsPhaseOf(turn, decision);
  const isChoosing = phase === 'choose';
  const isReview = phase === 'review';
  const isWaitingOnYou = isChoosing || isReview;
  const { send, error } = useAction(act);
  const [picked, setPicked] = useState<Picked>({ decision: undefined, choices: {} });
  const [queries, setQueries] = useState<Readonly<Record<string, string>>>({});
  const filterRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  // Your choices stay on their options while the model answers, and give way to its answer.
  const ownChoices =
    decision === undefined || picked.decision === decision.id ? picked.choices : {};
  const choices = isReview ? choicesOf(turn.suggestion?.answers) : ownChoices;

  const questions = Object.entries(turn.request.questions).map(([questionKey, question]) => {
    const options: Option[] = Object.entries(question.criteria).map(([key, text]) => ({
      key,
      text,
    }));
    const chosen = phase === 'read' ? chosenKey(turn, questionKey) : choices[questionKey];
    const view = listView(options, queries[questionKey] ?? '', chosen);
    const shownKeys = new Set(view.shown.map(option => option.key));
    const rows = sortOptions(
      optionRowsOf(turn, questionKey, question).filter(row => shownKeys.has(row.key)),
      sort,
    );
    return {
      key: questionKey,
      instructions: question.instructions,
      optionCount: options.length,
      matchCount: view.matchCount,
      query: queries[questionKey] ?? '',
      chosen,
      rows,
    };
  });

  const isComplete = isAnswerComplete(
    questions.map(question => question.key),
    choices,
  );

  const choose = (questionKey: string, optionKey: string) =>
    setPicked({ decision: decision?.id, choices: { ...ownChoices, [questionKey]: optionKey } });

  /** ↵: answers with your choices, or keeps the model's answer under review. */
  const answer = () => {
    if (decision === undefined || !isComplete) return;
    void send(
      isReview
        ? { type: 'confirm', decision: decision.id }
        : { type: 'answer', decision: decision.id, answers: choices },
    );
  };

  const askModel = () => {
    if (decision === undefined) return;
    void send({ type: 'askModel', decision: decision.id });
  };

  /** R: drops the model's answer under review, so you choose this turn afresh. */
  const pickAgain = () => {
    if (decision === undefined || !isReview) return;
    void send({ type: 'reopen', decision: decision.id });
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isWaitingOnYou || !isPageKey(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      answer();
      return;
    }
    if ((event.key === 'r' || event.key === 'R') && isReview) {
      event.preventDefault();
      pickAgain();
      return;
    }
    if (event.key === '/') {
      const filter = filterRef.current;
      if (filter === null) return;
      event.preventDefault();
      filter.focus();
      return;
    }
    if (!isChoosing) return;
    const keyed = keyedRows(
      questions.map(question => ({ questionKey: question.key, shown: question.rows })),
    );
    const row = keyed.find(entry => entry.keycap === event.key.toUpperCase());
    if (row === undefined) return;
    event.preventDefault();
    choose(row.questionKey, row.optionKey);
  });

  // An option focused while you choose would keep the page's keys once disabled, so it lets go.
  useEffect(() => {
    if (isChoosing) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && formRef.current?.contains(focused)) focused.blur();
  }, [isChoosing]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const modelName = model?.name ?? 'The model';

  return (
    <div ref={formRef} data-answer-form={isWaitingOnYou ? '' : undefined}>
      {questions.map(question => (
        <QuestionOptions
          key={question.key}
          questionKey={question.key}
          instructions={question.instructions}
          optionCount={question.optionCount}
          matchCount={question.matchCount}
          query={question.query}
          onQuery={query => setQueries(previous => ({ ...previous, [question.key]: query }))}
          filterRef={filterRef}
          onChoose={optionKey => choose(question.key, optionKey)}
          phase={phase}
          chosen={question.chosen}
          sort={sort}
          rows={question.rows}
          showsProbability={showsProbabilities(turn)}
          isAnsweredByYou={isAnsweredByYou(turn)}
        />
      ))}

      {isWaitingOnYou && (
        <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2">
          <Button
            type="button"
            disabled={!isComplete}
            onClick={answer}
            className={actionClass(true, !isComplete)}
          >
            {isReview ? 'Confirm' : 'Answer'}
            <Keycap>↵</Keycap>
          </Button>
          {isChoosing && model !== null && (
            <Button type="button" onClick={askModel} className={actionClass(false)}>
              Ask model
              <Keycap>S</Keycap>
            </Button>
          )}
          {isReview && (
            <Button type="button" onClick={pickAgain} className={actionClass(false)}>
              Pick again
              <Keycap>R</Keycap>
            </Button>
          )}
        </div>
      )}

      {phase === 'asking' && (
        <p role="status" className="mt-5 flex h-8 items-center gap-2 font-mono text-xs text-muted">
          <span
            aria-hidden
            className="size-3 rounded-full border-[1.5px] border-line border-t-ink motion-safe:animate-spin"
          />
          {`${modelName} is answering…`}
        </p>
      )}

      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-you">
          {error}
        </p>
      )}
    </div>
  );
};
