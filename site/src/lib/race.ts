// The recorded run the page tells and replays (the inspector's wiki race fixture), read at build
// time: every article, link, option, probability and count the page shows about the race comes from
// it, never from copy.
import { type InspectorEvent, InspectorEventSchema } from '@gut.run/core/inspector';
import recording from '../../../packages/inspector/src/fixtures/wikirace-clef.jsonl?raw';

type EventOf<T extends InspectorEvent['type']> = Extract<InspectorEvent, { type: T }>;

export const parseRecording = (text: string): InspectorEvent[] =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => InspectorEventSchema.parse(JSON.parse(line)));

const eventsOf = <T extends InspectorEvent['type']>(events: InspectorEvent[], type: T) =>
  events.filter((event): event is EventOf<T> => event.type === type);

const onlyEventOf = <T extends InspectorEvent['type']>(events: InspectorEvent[], type: T) => {
  const [event, ...rest] = eventsOf(events, type);
  if (event === undefined || rest.length > 0) {
    throw new Error(`the recording should hold exactly one ${type}`);
  }
  return event;
};

/** One option of a turn as the model read it, with the probability it gave. */
export type PickOption = { key: string; text: string; probability: number; isChosen: boolean };

/** One turn of a pick: the state and question it sent, and its options in the order sent. */
export type PickTurn = {
  state: EventOf<'turn.asked'>['request']['state'];
  instructions: string;
  options: PickOption[];
  chosen: PickOption;
};

const turnOf = (asked: EventOf<'turn.asked'>, answered: EventOf<'turn.answered'>): PickTurn => {
  const [[questionKey, question] = []] = Object.entries(asked.request.questions);
  const answer = questionKey === undefined ? undefined : answered.answers[questionKey];
  if (question === undefined || answer === undefined) {
    throw new Error(`round ${asked.round}, turn ${asked.turn} has no answered question`);
  }
  const options = Object.entries(question.criteria).map(([key, text]) => {
    const probability = answer.probabilities[key];
    if (probability === undefined) {
      throw new Error(`round ${asked.round}, turn ${asked.turn}: option ${key} has no probability`);
    }
    return { key, text, probability, isChosen: key === answer.choice };
  });
  const chosen = options.find(option => option.isChosen);
  if (chosen === undefined) {
    throw new Error(`round ${asked.round}, turn ${asked.turn}: the choice is not an option`);
  }
  return { state: asked.request.state, instructions: question.instructions, options, chosen };
};

/** One round of the race: what the task read, the goal check, and the pick, if it made one. */
export type RaceRound = {
  round: number;
  context: EventOf<'round.observed'>['context'];
  article: string;
  /** The race's one op, `openLink`: its description, and every link it offered, in order. */
  description: string;
  links: string[];
  isGoalAchieved: boolean;
  /** The pick's turns, in the order asked; none on the round that met the goal. */
  turns: PickTurn[];
  /** The step the pick ran, as gut names it (`openLink("Banana republic")`). */
  step: string | undefined;
  /** The link that step opened (`Banana republic`), as the article named it. */
  link: string | undefined;
};

/** The link a step of the race opened: `openLink("Banana republic")` opened `Banana republic`. */
export const linkOf = (step: string) => {
  const link = /^openLink\("(.+)"\)$/.exec(step)?.[1];
  if (link === undefined) throw new Error(`${step} is not a step of openLink`);
  return link;
};

const roundOf = (events: InspectorEvent[], observed: EventOf<'round.observed'>): RaceRound => {
  const { round, context, ops } = observed;
  const isInRound = (event: { round: number }) => event.round === round;
  const { currentArticle } = context;
  const [openLink, ...otherOps] = ops;
  if (typeof currentArticle !== 'string') throw new Error(`round ${round} has no currentArticle`);
  if (openLink?.kind !== 'choices' || otherOps.length > 0) {
    throw new Error(`round ${round} should offer one op of links`);
  }
  const step = eventsOf(events, 'round.picked').find(isInRound)?.step;
  const checked = eventsOf(events, 'round.goalChecked').find(isInRound);
  if (checked === undefined) throw new Error(`round ${round} never checked its goal`);
  const answered = eventsOf(events, 'turn.answered').filter(isInRound);
  const turns = eventsOf(events, 'turn.asked')
    .filter(isInRound)
    .map(asked => {
      const answer = answered.find(event => event.turn === asked.turn);
      if (answer === undefined) {
        throw new Error(`round ${round}, turn ${asked.turn} was never answered`);
      }
      return turnOf(asked, answer);
    });
  return {
    round,
    context,
    article: currentArticle,
    description: openLink.description,
    links: openLink.children.map(({ label }) => label),
    isGoalAchieved: checked.achieved,
    turns,
    step,
    link: step === undefined ? undefined : linkOf(step),
  };
};

export const readRace = (events: InspectorEvent[]) => {
  const started = onlyEventOf(events, 'run.started');
  const { result } = onlyEventOf(events, 'run.ended');
  if (started.model === null) throw new Error('the recorded run has no model');

  const rounds = eventsOf(events, 'round.observed').map(observed => roundOf(events, observed));

  return {
    name: started.name,
    model: started.model.name,
    maxOptions: started.model.maxOptions,
    status: result.status,
    /** As the inspector counts them: the last round is the goal check, with no pick. */
    rounds,
    articles: rounds.map(({ article }) => article),
    requests: result.usage.requests,
    inputTokens: result.usage.inputTokens,
  };
};

export const race = readRace(parseRecording(recording));
