import { Button } from '@base-ui/react/button';
import { cn } from '@fishballapps/cn';
import type { Action, ModelInfo } from '@gut.run/core/inspector';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { answerHint, isAnswerComplete, keyedRows, listView, optionsOf } from '../../lib/answer.ts';
import type { ActOutcome } from '../../lib/connection.ts';
import { isPageKey } from '../../lib/key-target.ts';
import { useAction } from '../../lib/use-action.ts';
import type { Decision, Turn } from '../../state/inspector-state.ts';
import { Keycap } from '../run/Keycap.tsx';
import { controlClass } from '../run/RunControls.tsx';
import { AnswerQuestion } from './AnswerQuestion.tsx';

/**
 * A turn waiting for you: its questions choosable, then Answer (↵) or Ask model (S). The parent
 * keys it by decision, so a choice never carries over to the next turn.
 */
export const AnswerForm = ({
  decision,
  turn,
  model,
  act,
}: {
  decision: Decision;
  turn: Turn;
  model: ModelInfo | null;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  const { send, error } = useAction(act);
  const [choices, setChoices] = useState<Readonly<Record<string, string>>>({});
  const [queries, setQueries] = useState<Readonly<Record<string, string>>>({});
  const filterRef = useRef<HTMLInputElement | null>(null);

  const questions = Object.entries(turn.request.questions).map(([key, question]) => ({
    key,
    instructions: question.instructions,
    options: optionsOf(question.criteria),
  }));
  const views = questions.map(question => ({
    ...question,
    view: listView(question.options, queries[question.key] ?? '', choices[question.key]),
  }));
  const rows = keyedRows(views.map(({ key, view }) => ({ questionKey: key, shown: view.shown })));
  const isComplete = isAnswerComplete(
    questions.map(question => question.key),
    choices,
  );

  const choose = (questionKey: string, optionKey: string) =>
    setChoices(previous => ({ ...previous, [questionKey]: optionKey }));

  const answer = () => {
    if (!isComplete) return;
    void send({ type: 'answer', decision: decision.id, answers: choices });
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isPageKey(event)) return;
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
    const row = rows.find(entry => entry.keycap === event.key.toUpperCase());
    if (row === undefined) return;
    event.preventDefault();
    choose(row.questionKey, row.optionKey);
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div data-answer-form>
      {views.map(({ key, instructions, options, view }) => (
        <AnswerQuestion
          key={key}
          questionKey={key}
          instructions={instructions}
          optionCount={options.length}
          view={view}
          chosen={choices[key]}
          query={queries[key] ?? ''}
          onChoose={optionKey => choose(key, optionKey)}
          onQuery={query => setQueries(previous => ({ ...previous, [key]: query }))}
          filterRef={filterRef}
        />
      ))}
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
          onClick={() => void send({ type: 'askModel', decision: decision.id })}
          className={cn(controlClass(false, model === null), 'h-8 px-3 text-[13px]')}
        >
          Ask model
          <Keycap>S</Keycap>
        </Button>
        <p className="text-xs text-muted">{answerHint(model)}</p>
      </div>
      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-you">
          {error}
        </p>
      )}
    </div>
  );
};
