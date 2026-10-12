// The page's link to `gut run --inspect`: one event stream it reduces into state, and the actions
// it posts. Both carry the token from the URL the CLI printed.
import { type Action, type InspectorEvent, InspectorEventSchema } from '@gut.run/core/inspector';
import { useEffect, useReducer, useState } from 'react';
import { z } from 'zod';
import { type InspectorState, initialState, reduce } from '../state/inspector-state.ts';

const params = new URLSearchParams(window.location.search);
const token = params.get('token') ?? '';

/**
 * The replay build (`vite build --mode replay`, the demo on gut.run) plays one recorded run with no
 * gut process behind it, so nothing on the page acts. In dev, `?fixture=<name>` plays any fixture.
 */
export const isReplay = import.meta.env.MODE === 'replay';

const fixture = (() => {
  if (isReplay) return 'wikirace-clef';
  if (import.meta.env.DEV) return params.get('fixture');
  return null;
})();

const fixtureLoaders = (() => {
  if (isReplay) {
    return import.meta.glob<string>('../fixtures/wikirace-clef.jsonl', {
      query: '?raw',
      import: 'default',
    });
  }
  if (import.meta.env.DEV) {
    return import.meta.glob<string>('../fixtures/*.jsonl', { query: '?raw', import: 'default' });
  }
  return {};
})();

/** Open while events flow; lost while EventSource reconnects (it resumes from the last id). */
export type ConnectionStatus = 'connecting' | 'open' | 'lost';

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A fresh stream replays from the start, so it starts from empty state (a hot reload reruns this). */
const RESET = { type: 'reset' } as const;

type PageAction = InspectorEvent | typeof RESET;

const isReset = (action: PageAction): action is typeof RESET => action === RESET;

const reducePage = (state: InspectorState, action: PageAction) =>
  isReset(action) ? initialState : reduce(state, action);

const loadFixtureEvents = async (
  name: string,
  dispatch: (action: PageAction) => void,
  setStatus: (status: ConnectionStatus) => void,
  isCancelled: () => boolean,
) => {
  const path = `../fixtures/${name}.jsonl`;
  const load = fixtureLoaders[path];
  if (load === undefined) {
    const available = Object.keys(fixtureLoaders)
      .map(key => key.slice('../fixtures/'.length, -'.jsonl'.length))
      .join(', ');
    throw new Error(`unknown fixture "${name}"; available: ${available}`);
  }

  const raw = await load();
  if (isCancelled()) {
    return;
  }

  const events: InspectorEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const parsed = InspectorEventSchema.safeParse(parseJson(trimmed));
    if (parsed.success && !(isReplay && isDecision(parsed.data))) {
      events.push(parsed.data);
    }
  }

  setStatus('open');

  for (const event of events) {
    if (isCancelled()) return;
    dispatch(event);
    const pause = pauseAfter(event);
    if (pause > 0) await new Promise(resolve => setTimeout(resolve, pause));
  }
};

/** A decision waits for someone at the page; a replay has no one, so it shows the run without them. */
const isDecision = (event: InspectorEvent) =>
  event.type === 'decision.pending' || event.type === 'decision.resolved';

/** How long the replay holds after each event: a visitor sees each turn asked, then answered. */
const REPLAY_PAUSE_MS: Partial<Record<InspectorEvent['type'], number>> = {
  'turn.asked': 700,
  'turn.answered': 1600,
  'round.picked': 400,
  'step.invoked': 300,
};

/** In dev, `&speed=<ms>` holds after every event; without it a fixture lands at once. */
const devSpeed = (() => {
  const speed = Number(params.get('speed'));
  return Number.isFinite(speed) && speed > 0 ? speed : 0;
})();

const pauseAfter = (event: InspectorEvent) =>
  isReplay ? (REPLAY_PAUSE_MS[event.type] ?? 0) : devSpeed;

export const useInspector = () => {
  const [state, dispatch] = useReducer(reducePage, initialState);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    dispatch(RESET);

    // A recorded run: the replay build's, or a dev fixture for page work without a live run.
    if (fixture !== null) {
      let isCancelled = false;
      void loadFixtureEvents(fixture, dispatch, setStatus, () => isCancelled);
      return () => {
        isCancelled = true;
      };
    }

    const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    source.addEventListener('open', () => setStatus('open'));
    source.addEventListener('error', () => setStatus('lost'));
    source.addEventListener('message', message => {
      // The CLI checked every run event; one the page doesn't know is from a newer CLI, and skipped.
      const event = InspectorEventSchema.safeParse(parseJson(message.data));
      if (event.success) dispatch(event.data);
    });
    return () => source.close();
  }, []);

  return { state, status };
};

export type ActOutcome = { ok: true } | { ok: false; status: number; error: string };

/** What the CLI answers a refused action with. */
const ErrorBodySchema = z.object({ error: z.string() });

export const act = async (action: Action): Promise<ActOutcome> => {
  if (fixture !== null) {
    return { ok: false, status: 0, error: 'a recorded run takes no actions' };
  }
  const response = await fetch('/api/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gut-token': token },
    body: JSON.stringify(action),
  });
  if (response.ok) return { ok: true };
  const body = ErrorBodySchema.safeParse(parseJson(await response.text()));
  return {
    ok: false,
    status: response.status,
    error: body.success ? body.data.error : response.statusText,
  };
};
