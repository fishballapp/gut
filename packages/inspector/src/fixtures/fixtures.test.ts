import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type InspectorEvent, InspectorEventSchema } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../state/inspector-state.ts';

const fixturesDir = import.meta.dirname;
const fixtureFiles = readdirSync(fixturesDir).filter(name => name.endsWith('.jsonl'));

describe('dev fixtures', () => {
  it('has recorded fixtures', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const filename of fixtureFiles) {
    it(`fixture ${filename} parses, starts with session.started, and reduces to >=1 run and >=1 round`, () => {
      const content = readFileSync(resolve(fixturesDir, filename), 'utf8');
      const lines = content.split('\n').filter(line => line.trim() !== '');

      expect(lines.length).toBeGreaterThan(0);

      const events: InspectorEvent[] = [];
      for (const [index, line] of lines.entries()) {
        const json: unknown = JSON.parse(line);
        const parsed = InspectorEventSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error(
            `line ${index + 1} of ${filename} failed validation: ${parsed.error.message}`,
          );
        }
        events.push(parsed.data);
      }

      expect(events[0]?.type).toBe('session.started');

      let state = initialState;
      for (const event of events) {
        state = reduce(state, event);
      }

      expect(state.incompatible).toBeUndefined();
      expect(state.runs.length).toBeGreaterThanOrEqual(1);

      const [run] = state.runs;
      if (run === undefined) {
        throw new Error(`expected at least one run in ${filename}`);
      }
      expect(run.rounds.length).toBeGreaterThanOrEqual(1);
    });
  }
});
