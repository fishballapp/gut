import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { cn } from 'cn';
import { type ReactNode, useState } from 'react';

/** A small, quiet button in a section's header: Copy, Edit. */
export const sectionButtonClass = cn(
  'inline-flex h-6 items-center gap-1.5 rounded-md border border-line px-1.5 text-xs text-muted',
  'hover:text-ink focus-visible:outline-2 focus-visible:outline-ink',
);

/** A panel section: its title, with its own controls at the right, over what it holds. */
export const Section = ({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <section aria-label={title} className="min-w-0">
    <div className="flex h-6 items-center justify-between gap-2 pb-2">
      <h3 className="text-xs font-semibold text-muted">{title}</h3>
      {actions !== undefined && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
    {children}
  </section>
);

/** Copies `text`, and says so for a moment. */
export const CopyButton = ({ text }: { text: () => string }) => {
  const [didCopy, setDidCopy] = useState(false);
  return (
    <button
      type="button"
      className={sectionButtonClass}
      onClick={() => {
        void navigator.clipboard.writeText(text()).then(() => {
          setDidCopy(true);
          window.setTimeout(() => setDidCopy(false), 1500);
        });
      }}
    >
      {didCopy ? <CheckIcon size={12} aria-hidden /> : <CopyIcon size={12} aria-hidden />}
      {didCopy ? 'Copied' : 'Copy'}
    </button>
  );
};
