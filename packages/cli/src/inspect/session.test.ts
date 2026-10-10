import {
  DecisionModelSchema,
  type DecisionRequest,
  type InspectorEvent,
  type RunEvent,
} from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import { createSession } from './session.ts';

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
  const session = createSession({
    task: 'task.gut.ts',
    emit: event => events.push(event),
    warn: message => warnings.push(message),
    readConfig: async from => {
      if (from.kind === 'path' && from.path === '~/gut.config.json') {
        return DecisionModelSchema.parse({ endpoint: jev.endpoint, name: 'jev', apiKey: 'k' });
      }
      throw new Error(`No gut config at ${from.kind === 'path' ? from.path : 'the text given'}`);
    },
  });
  const hooks = session.attach({ runId: 'r1' });
  const pendingId = () => {
    const pending = events.findLast(event => event.type === 'decision.pending');
    if (pending?.type !== 'decision.pending') throw new Error('nothing is pending');
    return pending.id;
  };
  return { events, warnings, session, hooks, pendingId };
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
    expect(
      await session.act({ type: 'loadConfig', from: { kind: 'path', path: '~/gut.config.json' } }),
    ).toEqual({ status: 204 });
    expect(events.at(-1)).toEqual({ type: 'session.model', model: jev });
    expect(JSON.stringify(events)).not.toContain('"k"');
    expect(await session.act({ type: 'clearModel' })).toEqual({ status: 204 });
    expect(events.at(-1)).toEqual({ type: 'session.model', model: null });
  });

  it("refuses a config it can't read, saying why", async () => {
    const { session } = setup();
    expect(
      await session.act({ type: 'loadConfig', from: { kind: 'path', path: './missing.json' } }),
    ).toEqual({ status: 400, error: 'No gut config at ./missing.json' });
  });

  it('drops an event that fails the schema, and says so', () => {
    const { events, warnings, hooks } = setup();
    // A core of another version could send anything.
    hooks.onEvent(JSON.parse('{"type":"round.observed","runId":"r1"}'));
    expect(events).toHaveLength(1);
    expect(warnings[0]).toContain('dropped an event');
  });

  it('knows whether any run attached', () => {
    const events: InspectorEvent[] = [];
    const session = createSession({
      task: 't',
      emit: e => events.push(e),
      warn: () => {},
      readConfig: async () => {
        throw new Error('unused');
      },
    });
    expect(session.hasAttached()).toBe(false);
    session.attach({ runId: 'r' });
    expect(session.hasAttached()).toBe(true);
  });
});
