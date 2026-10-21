import { cn } from 'cn';
import { type CopyBack, copyTextOf, MARK } from '../../lib/edit-copy.ts';
import type { DiffLine } from '../../lib/line-diff.ts';
import { CopyButton, Section } from './Section.tsx';

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
export const CopyBackPanel = ({ copy }: { copy: CopyBack }) => (
  <Section title="Copy into your task" actions={<CopyButton text={() => copyTextOf(copy)} />}>
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
  </Section>
);
