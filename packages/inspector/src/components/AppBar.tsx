import type { Action, ModelInfo } from '@gut.run/core/inspector';
import { ArrowUpRightIcon } from '@phosphor-icons/react';
import type { ActOutcome } from '../lib/connection.ts';
import { ModelChip } from './model/ModelChip.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

/** gut's own bar: nothing in it belongs to one run, except the model the selected run uses. */
export const AppBar = ({
  runModel,
  pageModel,
  act,
}: {
  runModel: ModelInfo | null;
  pageModel: ModelInfo | null;
  act: (action: Action) => Promise<ActOutcome>;
}) => (
  <header className="flex h-11 items-center gap-4 border-b border-line px-5 text-[13px] lg:col-span-3">
    <span className="rounded-[3px] bg-mark px-1.5 text-[17px] font-bold tracking-tight text-on-mark">
      gut
    </span>
    <span className="hidden text-muted sm:inline">inspector</span>
    <span className="flex-1" />
    <ModelChip runModel={runModel} pageModel={pageModel} act={act} />
    <a
      href="https://github.com/fishballapp/gut#readme"
      target="_blank"
      rel="noreferrer"
      className="hidden items-center gap-1 text-muted hover:text-ink sm:flex"
    >
      Docs <ArrowUpRightIcon size={12} />
    </a>
    <ThemeToggle />
  </header>
);
