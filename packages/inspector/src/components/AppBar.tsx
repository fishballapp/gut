import type { ModelInfo } from '@gut.run/core/inspector';
import { ArrowUpRightIcon } from '@phosphor-icons/react';
import { ThemeToggle } from './ThemeToggle.tsx';

/** The model by name, and the host that serves it. */
const describeModel = (model: ModelInfo) => `${model.name} · ${new URL(model.endpoint).host}`;

/** gut's own bar: nothing in it belongs to one run. */
export const AppBar = ({ model }: { model: ModelInfo | null }) => (
  <header className="col-span-3 flex h-11 items-center gap-4 border-b border-line px-5 text-[13px]">
    <span className="rounded-[3px] bg-mark px-1.5 text-[17px] font-bold tracking-tight text-on-mark">
      gut
    </span>
    <span className="text-muted">inspector</span>
    <span className="flex-1" />
    <span className="flex items-center gap-2 rounded-full border border-line bg-raised px-2.5 py-0.5">
      <span
        aria-hidden
        className={
          model === null
            ? 'size-[7px] rounded-full border-[1.5px] border-muted'
            : 'size-[7px] rounded-full bg-ok'
        }
      />
      {model === null ? 'No model' : describeModel(model)}
    </span>
    <a
      href="https://github.com/fishballapp/gut#readme"
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1 text-muted hover:text-ink"
    >
      Docs <ArrowUpRightIcon size={12} />
    </a>
    <ThemeToggle />
  </header>
);
