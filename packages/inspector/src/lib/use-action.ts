// Posts one action to the CLI and shows why it was refused, in place, for a few seconds.
import type { Action } from '@gut.run/core/inspector';
import { useEffect, useRef, useState } from 'react';
import type { ActOutcome } from './connection.ts';

const ERROR_MS = 4000;

/** Set while an action is on its way, page-wide: a second press waits rather than sending a 409. */
let isInFlight = false;

/** The line a refused action shows: a 409 means another tab answered the decision first. */
export const actionErrorMessage = (outcome: Extract<ActOutcome, { ok: false }>): string => {
  if (outcome.status === 409) return 'Answered in another tab';
  return outcome.error;
};

export const useAction = (act: (action: Action) => Promise<ActOutcome>) => {
  const [error, setError] = useState<string | undefined>();
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (errorTimer.current !== undefined) clearTimeout(errorTimer.current);
    },
    [],
  );

  const showError = (message: string) => {
    setError(message);
    if (errorTimer.current !== undefined) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(undefined), ERROR_MS);
  };

  /** Sends an action; resolves to whether the CLI took it. */
  const send = async (action: Action): Promise<boolean> => {
    if (isInFlight) return false;
    isInFlight = true;
    try {
      const outcome = await act(action);
      if (outcome.ok) return true;
      showError(actionErrorMessage(outcome));
      return false;
    } catch {
      showError("Can't reach gut");
      return false;
    } finally {
      isInFlight = false;
    }
  };

  return { send, error };
};
