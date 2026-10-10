import {
  DecisionModelSchema,
  type DecisionRequest,
  type InspectorEvent,
  type RunEvent,
} from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import { createSession, type TaskLink } from './session.ts';

const request: DecisionRequest = {
  state: { goal: 'done' },
  questions: {
    achieved: {
      instructions: 'Is the goal achieved?',
      criteria: { achieved: 'Goal achieved: done', notYet: 'Goal not achieved yet' },
    },
    next: { instructions: 'What should happen next?', criteria: { o1: 'A', o2: 'B' } },
  },
};

const started = (
  model: { name: string; endpoint: string; maxOptions: number } | null,
): RunEvent => ({
  type: 'run.started',
  runId: 'r1',
  name: 'test',
  model,
  inputTokenBudget: 1000,
  isGoalCheckedInCode: false,
});

const jev = { name: 'jev', endpoint: 'https://openrouter.ai/api/v1/systemone', maxOptions: 255 };

const setup = () => {
  const events: InspectorEvent[] = [];
  const warnings: string[] = [];
  /** Each task process the session started, in order; `stops` counts the ones it stopped. */
  const links: TaskLink[] = [];
  let stops = 0;
  const session = createSession({
    task: 'task.gut.ts',
    emit: event => events.push(event),
    clear: () => events.splice(0),
    warn: message => warnings.push(message),
    readConfig: async path => {
      if (path === '~/gut.config.json') {
        return DecisionModelSchema.parse({ endpoint: jev.endpoint, name: 'jev', apiKey: 'k' });
      }
      throw new Error(`No gut config at ${path}`);
    },
    start: link => {
      links.push(link);
      return {
        stop: async () => {
          stops += 1;
        },
      };
    },
  });
  const link = links[0];
  if (link === undefined) throw new Error('no task was started');
  const hooks = link.attach({ runId: 'r1' });
  const pendingId = () => {
    const pending = events.findLast(event => event.type === 'decision.pending');
    if (pending?.type !== 'decision.pending') throw new Error('nothing is pending');
    return pending.id;
  };
  return {
    events,
    warnings,
    session,
    link,
    links,
    hooks,
    pendingId,
    stops: () => stops,
  };
};

describe('createSession', () => {
  it('starts in Step and records the session', () => {
    const { events } = setup();
    expect(events[0]).toEqual({
      type: 'session.started',
      protocol: 1,
      task: 'task.gut.ts',
      mode: 'step',
    });
  });

  it('waits at a turn until a person answers it', async () => {
    const { events, session, hooks, pendingId } = setup();
    const answer = hooks.answer({ round: 1, turn: 1, request });
    expect(events.at(-1)).toMatchObject({
      type: 'decision.pending',
      round: 1,
      on: { kind: 'turn', turn: 1 },
    });
    const answers = { achieved: 'notYet', next: 'o2' };
    expect(await session.act({ type: 'answer', decision: pendingId(), answers })).toEqual({
      status: 204,
    });
    await expect(answer).resolves.toEqual({ by: 'you', answers });
    expect(events.at(-1)).toMatchObject({ type: 'decision.resolved', by: 'you' });
  });

  it('refuses answers core would reject, and keeps the turn waiting', async () => {
    const { session, hooks, pendingId } = setup();
    void hooks.answer({ round: 1, turn: 1, request });
    const id = pendingId();
    expect(
      await session.act({ type: 'answer', decision: id, answers: { next: 'o1' } }),
    ).toMatchObject({
      status: 400,
      error: 'missing answer for question "achieved"',
    });
    expect(
      await session.act({
        type: 'answer',
        decision: id,
        answers: { achieved: 'notYet', next: 'o9' },
      }),
    ).toMatchObject({ status: 400 });
    expect(
      await session.act({
        type: 'answer',
        decision: id,
        answers: { achieved: 'notYet', next: 'o1' },
      }),
    ).toEqual({ status: 204 });
  });

  it('lets the first action on a decision win; later ones get 409', async () => {
    const { session, hooks, pendingId } = setup();
    void hooks.answer({ round: 1, turn: 1, request });
    const id = pendingId();
    expect(await session.act({ type: 'repick', decision: id })).toEqual({ status: 204 });
    expect(await session.act({ type: 'repick', decision: id })).toMatchObject({ status: 409 });
  });

  it('asks the model only when there is one', async () => {
    const { session, hooks, pendingId } = setup();
    hooks.onEvent(started(null));
    const answer = hooks.answer({ round: 1, turn: 1, request });
    expect(await session.act({ type: 'askModel', decision: pendingId() })).toMatchObject({
      status: 400,
      error: 'no model: add one first',
    });
    expect(
      await session.act({
        type: 'setModel',
        model: { endpoint: jev.endpoint, name: 'jev', apiKey: 'sk-secret', maxOptions: 255 },
      }),
    ).toEqual({ status: 204 });
    expect(await session.act({ type: 'askModel', decision: pendingId() })).toEqual({ status: 204 });
    await expect(answer).resolves.toMatchObject({
      by: 'model',
      model: { name: 'jev', apiKey: 'sk-secret' },
    });
  });

  it('never puts the page model key in an event', async () => {
    const { events, session } = setup();
    await session.act({
      type: 'setModel',
      model: { endpoint: jev.endpoint, name: 'jev', apiKey: 'sk-secret' },
    });
    expect(events.at(-1)).toEqual({ type: 'session.model', model: jev });
    expect(JSON.stringify(events)).not.toContain('sk-secret');
  });

  it('asks a question too big for the model again at its size, instead of failing the run', async () => {
    const { session, hooks, pendingId } = setup();
    hooks.onEvent(started(null));
    const threeOptions: DecisionRequest = {
      state: { goal: 'done' },
      questions: { next: { instructions: 'Which?', criteria: { o1: 'A', o2: 'B', o3: 'C' } } },
    };
    const answer = hooks.answer({ round: 1, turn: 1, request: threeOptions });
    await session.act({
      type: 'setModel',
      model: { endpoint: jev.endpoint, name: 'tiny', maxOptions: 2 },
    });
    await session.act({ type: 'askModel', decision: pendingId() });
    await expect(answer).resolves.toEqual({ repick: true });
    await expect(hooks.beforePick({ round: 1 })).resolves.toEqual({ maxOptions: 2 });
  });

  it("uses the run's own model over the page's", async () => {
    const { session, hooks, pendingId } = setup();
    hooks.onEvent(started(jev));
    await session.act({ type: 'setModel', model: { endpoint: jev.endpoint, name: 'other' } });
    const answer = hooks.answer({ round: 1, turn: 1, request });
    await session.act({ type: 'askModel', decision: pendingId() });
    await expect(answer).resolves.toEqual({ by: 'model' });
  });

  it('plays without waiting once there is a model, and Play resolves what waits', async () => {
    const { events, session, hooks } = setup();
    hooks.onEvent(started(jev));
    const waiting = hooks.answer({ round: 1, turn: 1, request });
    const step = hooks.beforeInvoke({ round: 1, step: 'a' });
    expect(await session.act({ type: 'play' })).toEqual({ status: 204 });
    await expect(waiting).resolves.toEqual({ by: 'model' });
    await expect(step).resolves.toBe('invoke');
    await expect(hooks.answer({ round: 2, turn: 1, request })).resolves.toEqual({ by: 'model' });
    expect(events.filter(event => event.type === 'session.mode')).toEqual([
      { type: 'session.mode', mode: 'play' },
    ]);
  });

  it('keeps a run without a model waiting in Play', async () => {
    const { events, session, hooks } = setup();
    hooks.onEvent(started(null));
    await session.act({ type: 'play' });
    void hooks.answer({ round: 1, turn: 1, request });
    expect(events.at(-1)).toMatchObject({ type: 'decision.pending' });
  });

  it('waits before a step: Run invokes it, Pick again re-picks', async () => {
    const { session, hooks, pendingId } = setup();
    const first = hooks.beforeInvoke({ round: 1, step: 'a' });
    expect(await session.act({ type: 'askModel', decision: pendingId() })).toMatchObject({
      status: 400,
    });
    await session.act({ type: 'run', decision: pendingId() });
    await expect(first).resolves.toBe('invoke');
    const second = hooks.beforeInvoke({ round: 2, step: 'b' });
    await session.act({ type: 'repick', decision: pendingId() });
    await expect(second).resolves.toBe('repick');
  });

  it("sizes questions by the run's model, else the page's, else for a person", async () => {
    const { session, hooks } = setup();
    await expect(hooks.beforePick({ round: 1 })).resolves.toEqual({ maxOptions: 26 });
    await session.act({
      type: 'setModel',
      model: { endpoint: jev.endpoint, name: 'clef', maxOptions: 40 },
    });
    await expect(hooks.beforePick({ round: 1 })).resolves.toEqual({ maxOptions: 40 });
    hooks.onEvent(started(jev));
    await expect(hooks.beforePick({ round: 1 })).resolves.toEqual({ maxOptions: 255 });
  });

  it("loads a gut config's model, keeps its key, and clears it again", async () => {
    const { events, session } = setup();
    expect(await session.act({ type: 'loadConfig', path: '~/gut.config.json' })).toEqual({
      status: 204,
    });
    expect(events.at(-1)).toEqual({ type: 'session.model', model: jev });
    expect(JSON.stringify(events)).not.toContain('"k"');
    expect(await session.act({ type: 'clearModel' })).toEqual({ status: 204 });
    expect(events.at(-1)).toEqual({ type: 'session.model', model: null });
  });

  it("refuses a config it can't read, saying why", async () => {
    const { session } = setup();
    expect(await session.act({ type: 'loadConfig', path: './missing.json' })).toEqual({
      status: 400,
      error: 'No gut config at ./missing.json',
    });
  });

  it('ends with the task, recording its error', () => {
    const { events, warnings, link } = setup();
    link.end('boom');
    expect(events.at(-1)).toEqual({ type: 'session.ended', error: 'boom' });
    expect(warnings).toEqual(['The task ended: boom', 'The inspector stays up until Ctrl-C.']);
  });

  it('says no run attached when the task never started one', () => {
    const events: InspectorEvent[] = [];
    const warnings: string[] = [];
    const links: TaskLink[] = [];
    createSession({
      task: 't',
      emit: event => events.push(event),
      clear: () => {},
      warn: message => warnings.push(message),
      readConfig: async () => {
        throw new Error('unused');
      },
      start: link => {
        links.push(link);
        return { stop: async () => {} };
      },
    });
    links[0]?.end();
    expect(warnings).toEqual([
      'The task ended.',
      'No run attached: the task never called runTask, or its @gut.run/core predates the inspector.',
      'The inspector stays up until Ctrl-C.',
    ]);
  });

  it('restarts: stops the task, forgets what waited, and starts it afresh', async () => {
    const { events, session, links, hooks, pendingId, stops } = setup();
    void hooks.answer({ round: 1, turn: 1, request });
    await session.act({ type: 'setModel', model: { endpoint: jev.endpoint, name: 'jev' } });
    const waiting = pendingId();

    expect(await session.act({ type: 'restart' })).toEqual({ status: 204 });
    expect(stops()).toBe(1);
    expect(links).toHaveLength(2);
    // The record starts afresh with the same mode, and the page's model again.
    expect(events).toEqual([
      { type: 'session.started', protocol: 1, task: 'task.gut.ts', mode: 'step' },
      { type: 'session.model', model: { name: 'jev', endpoint: jev.endpoint, maxOptions: 255 } },
    ]);
    expect(await session.act({ type: 'answer', decision: waiting, answers: {} })).toMatchObject({
      status: 409,
    });
  });

  it('keeps the mode through a restart', async () => {
    const { events, session } = setup();
    await session.act({ type: 'play' });
    await session.act({ type: 'restart' });
    expect(events[0]).toEqual({
      type: 'session.started',
      protocol: 1,
      task: 'task.gut.ts',
      mode: 'play',
    });
  });

  it('ignores what a stopped task sends after a restart', async () => {
    const { events, session, links } = setup();
    const old = links[0];
    await session.act({ type: 'restart' });
    const countBefore = events.length;
    old?.attach({ runId: 'old' }).onEvent({
      type: 'run.started',
      runId: 'old',
      name: 'old',
      model: null,
      inputTokenBudget: 1,
      isGoalCheckedInCode: false,
    });
    old?.end('late');
    expect(events).toHaveLength(countBefore);
  });

  it('a stale task reaches nothing while it is being stopped', async () => {
    const events: InspectorEvent[] = [];
    const links: TaskLink[] = [];
    /** Each process's stop, held open until the test releases it. */
    const releases: (() => void)[] = [];
    const session = createSession({
      task: 'task.gut.ts',
      emit: event => events.push(event),
      clear: () => events.splice(0),
      warn: () => {},
      readConfig: async () => {
        throw new Error('unused');
      },
      start: link => {
        links.push(link);
        return {
          stop: () =>
            new Promise<void>(resolve => {
              releases.push(resolve);
            }),
        };
      },
    });
    const old = links[0]?.attach({ runId: 'r1' });
    if (old === undefined) throw new Error('no task was started');
    const waiting = old.answer({ round: 1, turn: 1, request });
    expect(events.at(-1)).toMatchObject({ type: 'decision.pending', id: 'd1' });

    const restarting = session.act({ type: 'restart' });
    const during = events.length;
    // The old task's hooks, called during the grace period: a turn, a pick, a step, an event.
    const settled: unknown[] = [];
    for (const call of [
      old.answer({ round: 1, turn: 2, request }),
      old.beforePick({ round: 1 }),
      old.beforeInvoke({ round: 1, step: 'add' }),
    ]) {
      void call.then(value => settled.push(value));
    }
    old.onEvent({
      type: 'run.started',
      runId: 'r1',
      name: 'old',
      model: null,
      inputTokenBudget: 1,
      isGoalCheckedInCode: false,
    });
    expect(events).toHaveLength(during);

    // The restart stops the old process once its turn in the queue comes up.
    await new Promise(resolve => setTimeout(resolve, 0));
    for (const release of releases) release();
    expect(await restarting).toEqual({ status: 204 });
    // The restart's record holds only what the new process says; the old decision is gone.
    expect(events.map(event => event.type)).toEqual(['session.started']);
    expect(await session.act({ type: 'answer', decision: 'd1', answers: {} })).toMatchObject({
      status: 409,
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(settled).toEqual([]);
    void waiting.then(value => settled.push(value));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(settled).toEqual([]);
  });

  it('stops the task without starting another', async () => {
    const { session, links, stops } = setup();
    await session.stop();
    expect(stops()).toBe(1);
    expect(links).toHaveLength(1);
  });
});
