import { Button } from '@base-ui/react/button';
import { Tooltip } from '@base-ui/react/tooltip';
import { cn } from '@fishballapps/cn';
import type { Action } from '@gut.run/core/inspector';
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import { isShortcutBlockedTarget } from '../../lib/shortcut-target.ts';
import type { Decision, InspectorState, Run } from '../../state/inspector-state.ts';
import { Keycap } from './Keycap.tsx';

const ERROR_MS = 4000;

const oldestPending = (pending: Decision[], runId: string | undefined): Decision | undefined => {
  if (runId === undefined) return undefined;
  return pending.find(decision => decision.runId === runId);
};

const actionErrorMessage = (outcome: Extract<ActOutcome, { ok: false }>): string => {
  if (outcome.status === 409) return 'Answered in another tab';
  return outcome.error;
};

const controlClass = (isPrimary: boolean, isDisabled: boolean) =>
  cn(
    'inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] font-medium',
    isDisabled && 'cursor-not-allowed border-line text-muted opacity-60',
    !isDisabled && isPrimary && 'border-ink bg-ink text-ground hover:opacity-90',
    !isDisabled && !isPrimary && 'border-line bg-raised text-ink hover:border-ink/40',
  );

/** Focusable even when disabled, so a tooltip reason can open on focus. */
const ControlButton = ({
  reason,
  isDisabled,
  isPrimary,
  ariaLabel,
  onClick,
  children,
}: {
  reason: string | undefined;
  isDisabled: boolean;
  isPrimary: boolean;
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
}) => {
  const buttonProps = {
    type: 'button' as const,
    'aria-label': ariaLabel,
    disabled: isDisabled,
    focusableWhenDisabled: true,
    onClick,
    className: controlClass(isPrimary, isDisabled),
  };
  if (reason === undefined) {
    return <Button {...buttonProps}>{children}</Button>;
  }
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<Button {...buttonProps} />}>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className="rounded-md border border-line bg-raised px-2 py-1 text-[12px] text-ink shadow-sm">
            {reason}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};

/** Play / Pause (Space) and Step (S): the model does the next thing, or everything. */
export const RunControls = ({
  state,
  run,
  act,
}: {
  state: InspectorState;
  run: Run | undefined;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  const [error, setError] = useState<string | undefined>();
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isInFlight = useRef(false);

  const model = run?.model ?? state.pageModel;
  const hasModel = model !== null;
  const pending = oldestPending(state.pending, run?.runId);
  // Once the task has ended nothing more will run, so there is nothing to play or pause.
  const hasEnded = state.ended !== undefined;
  const isPlaying = state.mode === 'play' && !hasEnded;
  const isPlayDisabled = hasEnded || (!hasModel && !isPlaying);

  const playDisabledReason = (() => {
    if (hasEnded) return 'The task has ended';
    if (!hasModel) return 'Play needs a model: add one';
    return undefined;
  })();
  const stepDisabledReason = (() => {
    if (hasEnded) return 'The task has ended';
    if (!hasModel) return 'Step needs a model: add one';
    if (pending === undefined) return 'Nothing is waiting';
    return undefined;
  })();

  const showError = (message: string) => {
    setError(message);
    if (errorTimer.current !== undefined) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(undefined), ERROR_MS);
  };

  const post = async (action: Action) => {
    if (isInFlight.current) return;
    isInFlight.current = true;
    try {
      const outcome = await act(action);
      if (!outcome.ok) showError(actionErrorMessage(outcome));
    } catch {
      showError("Can't reach gut");
    } finally {
      isInFlight.current = false;
    }
  };

  const playPause = () => {
    if (isPlayDisabled) return;
    void post({ type: isPlaying ? 'pause' : 'play' });
  };

  const step = () => {
    if (!hasModel || pending === undefined) return;
    void post(
      pending.on.kind === 'turn'
        ? { type: 'askModel', decision: pending.id }
        : { type: 'run', decision: pending.id },
    );
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.repeat) return;
    if (isShortcutBlockedTarget(event.target)) return;
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      playPause();
      return;
    }
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      step();
    }
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (errorTimer.current !== undefined) clearTimeout(errorTimer.current);
    };
  }, []);

  return (
    <div className="flex flex-col items-end gap-1">
      <Tooltip.Provider delay={200}>
        <div className="flex items-center gap-1.5">
          <ControlButton
            reason={playDisabledReason}
            isDisabled={isPlayDisabled}
            isPrimary={isPlaying}
            ariaLabel={isPlaying ? 'Pause' : 'Play'}
            onClick={playPause}
          >
            {isPlaying ? 'Pause' : 'Play'}
            <Keycap>Space</Keycap>
          </ControlButton>
          <ControlButton
            reason={stepDisabledReason}
            isDisabled={stepDisabledReason !== undefined}
            isPrimary={false}
            ariaLabel="Step"
            onClick={step}
          >
            Step
            <Keycap>S</Keycap>
          </ControlButton>
        </div>
      </Tooltip.Provider>
      {error !== undefined && (
        <p role="status" className="max-w-[220px] text-right text-[11px] text-you">
          {error}
        </p>
      )}
    </div>
  );
};
