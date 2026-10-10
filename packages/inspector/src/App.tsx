import { AppBar } from './components/AppBar.tsx';
import { GutBackground } from './components/GutBackground.tsx';
import { useInspector } from './lib/connection.ts';

/**
 * The page, by level: gut's bar; the run (its goal and controls, and the strip of its rounds);
 * then the rounds, the selected turn, and the selected round's op tree and context.
 */
export const App = () => {
  const { state, status } = useInspector();
  const run = state.runs.at(-1);
  const goal = run?.rounds.at(-1)?.context.goal;
  return (
    <div className="relative isolate grid h-full grid-cols-[264px_1fr_400px] grid-rows-[auto_auto_1fr]">
      <GutBackground />
      <AppBar model={run?.model ?? state.pageModel} />
      <section aria-label="Run" className="col-span-3 border-b border-line px-5 pt-[18px] pb-4">
        <p className="font-mono text-xs text-muted">
          {[state.task, run?.name].filter(Boolean).join(' · ')}
          {status === 'lost' && ' · reconnecting…'}
        </p>
        <p className="mt-0.5 text-xs font-medium text-muted">Goal</p>
        <h1 className="text-2xl font-semibold tracking-tight">{goal ?? state.task ?? 'gut'}</h1>
      </section>
      <nav aria-label="Rounds" className="overflow-auto border-r border-line px-2.5 py-3.5">
        <h2 className="px-2.5 pb-2 text-xs font-semibold text-muted">Rounds</h2>
        <ol>
          {run?.rounds.map(round => (
            <li key={round.round} className="flex gap-2 px-2.5 py-2">
              <span className="font-mono text-xs text-muted tabular-nums">{round.round}</span>
              <span className="truncate font-mono">{round.picked?.step ?? '…'}</span>
            </li>
          ))}
        </ol>
      </nav>
      <main className="relative overflow-auto px-8 py-6">
        {state.incompatible !== undefined && (
          <p role="alert" className="rounded-lg border border-you p-4 text-you">
            This page speaks inspector protocol {state.incompatible.page}, and this gut speaks{' '}
            {state.incompatible.cli}. Build the page from the same gut version as the CLI.
          </p>
        )}
        {state.incompatible === undefined && (run?.rounds.length ?? 0) === 0 && (
          <div className="grid h-full place-items-center text-center text-muted">
            <p>
              <span className="block text-base font-semibold text-ink">
                Waiting for the first round
              </span>
              Rounds appear here as they happen.
            </p>
          </div>
        )}
      </main>
      <aside aria-label="Round" className="overflow-auto border-l border-line p-5" />
    </div>
  );
};
