import { Button } from '@base-ui/react/button';
import { cn } from '@fishballapps/cn';
import type { Action, ModelInfo } from '@gut.run/core/inspector';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  answerHint,
  isAnswerComplete,
  keyedRows,
  listView,
  type Option,
} from '../../lib/answer.ts';
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
import { controlClass } from '../run/RunControls.tsx';
import { QuestionOptions } from './QuestionOptions.tsx';

/**
 * The options of the selected turn, in the phase it is in. While you choose, the answer buttons sit
 * under the questions; while the model answers, a spinner sits where they were. The parent keys it
 * by the decision you answer, so a choice never carries over to the next turn.
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
  const phase = optionsPhaseOf(turn, decision !== undefined);
  const isChoosing = phase === 'choose';
  const { send, error } = useAction(act);
  const [choices, setChoices] = useState<Readonly<Record<string, string>>>({});
  const [queries, setQueries] = useState<Readonly<Record<string, string>>>({});
  const filterRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  const questions = Object.entries(turn.request.questions).map(([questionKey, question]) => {
    const options: Option[] = Object.entries(question.criteria).map(([key, text]) => ({
      key,
      text,
    }));
    // Your pick stays on its option while the model answers; the turn's answer replaces it once read.
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
    setChoices(previous => ({ ...previous, [questionKey]: optionKey }));

  const answer = () => {
    if (decision === undefined || !isComplete) return;
    void send({ type: 'answer', decision: decision.id, answers: choices });
  };

  const askModel = () => {
    if (decision === undefined) return;
    void send({ type: 'askModel', decision: decision.id });
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isChoosing || !isPageKey(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      answer();
      return;
    }
    if (event.key === '/') {
      const filter = filterRef.current;
      if (filter === null) return;
      event.preventDefault();
      filter.focus();
      return;
    }
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
    <div ref={formRef} data-answer-form={isChoosing ? '' : undefined}>
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

      {isChoosing && (
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            disabled={!isComplete}
            onClick={answer}
            className={cn(controlClass(true, !isComplete), 'h-8 px-3 text-[13px]')}
          >
            Answer
            <Keycap>↵</Keycap>
          </Button>
          <Button
            type="button"
            disabled={model === null}
            onClick={askModel}
            className={cn(controlClass(false, model === null), 'h-8 px-3 text-[13px]')}
          >
            Ask model
            <Keycap>S</Keycap>
          </Button>
          <p className="text-xs text-muted">{answerHint(model)}</p>
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
