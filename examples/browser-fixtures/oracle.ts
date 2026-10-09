export type JobName = 'docs' | 'directory' | 'form' | 'delayed';
export type LayoutName = 'layout-a' | 'layout-b';

/**
 * Whether a fixture job is done. A page goal (docs, directory) is done when the browser is on that
 * page, not when the page was merely requested; a form or an action is done when the server
 * received it.
 */
export type FixtureOracle = {
  form: Record<LayoutName, { destination: string; date: string } | null>;
  delayed: Record<LayoutName, boolean>;
  isDone: (job: JobName, layout: LayoutName, pageUrl: string) => boolean;
  reset: () => void;
};

const GOAL_PATHS: Record<'docs' | 'directory', string> = {
  docs: 'rate-limits',
  directory: 'manchester',
};

export const createFixtureOracle = (): FixtureOracle => {
  const oracle: FixtureOracle = {
    form: { 'layout-a': null, 'layout-b': null },
    delayed: { 'layout-a': false, 'layout-b': false },
    isDone: (job, layout, pageUrl) => {
      if (job === 'docs' || job === 'directory') {
        return new URL(pageUrl).pathname === `/${job}/${layout}/${GOAL_PATHS[job]}`;
      }
      if (job === 'form') {
        const submitted = oracle.form[layout];
        return submitted?.destination === 'Tokyo' && submitted.date === '2026-10-15';
      }
      return oracle.delayed[layout];
    },
    reset: () => {
      oracle.form = { 'layout-a': null, 'layout-b': null };
      oracle.delayed = { 'layout-a': false, 'layout-b': false };
    },
  };
  return oracle;
};
