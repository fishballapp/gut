import { describe, expect, it } from 'vitest';
import recording from '../../../packages/inspector/src/fixtures/wikirace-clef.jsonl?raw';
import { linkOf, parseRecording, race, readRace } from './race.ts';

// The page tells these facts about the recorded race; re-recording it must keep them true, or the
// story's captions say something the run didn't do.
describe('the recorded race', () => {
  it('runs from Banana to Roman Empire and achieves its goal', () => {
    expect(race.status).toBe('achieved');
    expect(race.articles.at(0)).toBe('Banana');
    expect(race.articles.at(-1)).toBe('Roman Empire');
  });

  it('opens on a pick of bundles, then a link inside the chosen one', () => {
    const [first] = race.rounds;
    const [bundles, links] = first?.turns ?? [];
    if (first === undefined || bundles === undefined || links === undefined) {
      throw new Error('round 1 should ask two turns');
    }
    expect(first.turns).toHaveLength(2);
    expect(bundles.options.length).toBeLessThanOrEqual(race.maxOptions);
    // A bundle reads "Contains:" and then a line per link.
    expect(
      bundles.chosen.text
        .split('\n')
        .slice(1)
        .map(line => line.trim()),
    ).toEqual(links.options.map(option => option.text));
    expect(first.step).toBe(`openLink("${race.articles[1]}")`);
  });

  it('checks the goal in code every round, and ends on a round with no request', () => {
    const last = race.rounds.at(-1);
    expect(
      race.rounds.slice(0, -1).every(round => !round.isGoalAchieved && round.turns.length > 0),
    ).toBe(true);
    expect(last).toMatchObject({ article: 'Roman Empire', isGoalAchieved: true, turns: [] });
  });
});

describe('a step', () => {
  it('names the link it opened, as the article named it', () => {
    expect(linkOf('openLink("Banana republic")')).toBe('Banana republic');
    // A link can name a redirect: the race clicked "Taino" to reach the article "Taíno".
    expect(race.rounds.find(({ link }) => link === 'Taino')?.round).toBe(4);
  });

  it('fails on anything but openLink', () => {
    expect(() => linkOf('scroll()')).toThrow(/not a step of openLink/);
  });
});

describe('a malformed recording', () => {
  it('fails on an event the schema rejects', () => {
    expect(() => parseRecording('{"type":"turn.answered"}')).toThrow();
  });

  it('fails when an option of a pick has no probability', () => {
    const lines = recording.trimEnd().split('\n');
    const lastAnswer = lines.findLastIndex(line => line.includes('"turn.answered"'));
    const broken = lines.with(lastAnswer, lines[lastAnswer]?.replace(/"o1":[0-9.e-]+,?/, '') ?? '');
    expect(() => readRace(parseRecording(broken.join('\n')))).toThrow(/has no probability/);
  });
});
