import { cn } from '@fishballapps/cn';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { type CopyBack, copyTextOf, MARK } from '../../lib/edit-copy.ts';
import type { DiffLine } from '../../lib/line-diff.ts';

const DiffRow = ({ line }: { line: DiffLine }) => (
  <li
    className={cn(
      'whitespace-pre-wrap break-all',
      line.kind === 'removed' && 'text-muted line-through',
      line.kind === 'added' && 'text-you',
      line.kind === 'same' && 'text-muted',
    )}
  >
    {`${MARK[line.kind]} ${line.text}`}
  </li>
);

/**
 * What a round's edits changed, to copy into the task's code: a line per change, and the context's
 * diff. The copied text is the text shown.
 */
export const CopyBackPanel = ({ copy }: { copy: CopyBack }) => {
  const [didCopy, setDidCopy] = useState(false);
  return (
    <section aria-label="Copy into your task" className="min-w-0">
      <div className="flex items-center justify-between gap-2 pb-2">
        <h3 className="text-xs font-semibold text-muted">Copy into your task</h3>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-xs text-muted',
            'hover:text-ink focus-visible:outline-2 focus-visible:outline-ink',
          )}
          onClick={() => {
            void navigator.clipboard.writeText(copyTextOf(copy)).then(() => {
              setDidCopy(true);
              window.setTimeout(() => setDidCopy(false), 1500);
            });
          }}
        >
          {didCopy ? <CheckIcon size={12} aria-hidden /> : <CopyIcon size={12} aria-hidden />}
          {didCopy ? 'Copied' : 'Copy'}
        </button>
      </div>
      <ul className="space-y-0.5 font-mono text-[12px] leading-relaxed">
        {copy.changes.map(change => (
          <li key={change} className="whitespace-pre-wrap break-all text-ink">
            {change}
          </li>
        ))}
        {copy.context !== undefined && (
          <>
            <li className="pt-1 text-muted">context:</li>
            {copy.context.map((line, index) => (
              <DiffRow key={index} line={line} />
            ))}
          </>
        )}
      </ul>
    </section>
  );
};
