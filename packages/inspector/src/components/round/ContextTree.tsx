import { Collapsible } from '@base-ui/react/collapsible';
import { cn } from '@fishballapps/cn';
import { CaretRightIcon, CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const JsonPrimitive = ({ value }: { value: string | number | boolean | null }) => {
  if (typeof value === 'string') {
    return <span className="break-words font-mono text-ink">"{value}"</span>;
  }
  if (typeof value === 'number') {
    return <span className="font-mono text-ink">{value}</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="font-mono text-muted">{value ? 'true' : 'false'}</span>;
  }
  return <span className="font-mono text-muted">null</span>;
};

const JsonFold = ({
  name,
  openBracket,
  closedSummary,
  closeBracket,
  isDefaultOpen,
  children,
}: {
  name?: string;
  openBracket: string;
  closedSummary: string;
  closeBracket: string;
  isDefaultOpen: boolean;
  children: ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(isDefaultOpen);
  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen} className="min-w-0">
      <Collapsible.Trigger className="flex w-full min-w-0 items-baseline gap-1.5 py-0.5 text-left">
        <CaretRightIcon
          size={12}
          weight="bold"
          className={cn(
            'relative top-px shrink-0 text-faint transition-transform motion-reduce:transition-none',
            isOpen && 'rotate-90',
          )}
          aria-hidden
        />
        {name !== undefined && <span className="shrink-0 text-muted">{name}</span>}
        <span className="text-muted">{openBracket}</span>
        {!isOpen && <span className="truncate font-normal text-muted">{closedSummary}</span>}
      </Collapsible.Trigger>
      <Collapsible.Panel>
        {children}
        <div className="ps-4 text-muted">{closeBracket}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
};

const JsonNode = ({
  name,
  value,
  isDefaultOpen = true,
}: {
  name?: string;
  value: unknown;
  isDefaultOpen?: boolean;
}) => {
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    const n = entries.length;
    return (
      <JsonFold
        name={name}
        openBracket="{"
        closedSummary={`${n} ${n === 1 ? 'key' : 'keys'} }`}
        closeBracket="}"
        isDefaultOpen={isDefaultOpen}
      >
        <ul className="ms-3 border-l border-line ps-3">
          {entries.map(([key, child]) => (
            <li key={key} className="min-w-0 py-0.5">
              <JsonNode name={key} value={child} isDefaultOpen={false} />
            </li>
          ))}
        </ul>
      </JsonFold>
    );
  }

  if (Array.isArray(value)) {
    const n = value.length;
    return (
      <JsonFold
        name={name}
        openBracket="["
        closedSummary={`${n} ${n === 1 ? 'item' : 'items'} ]`}
        closeBracket="]"
        isDefaultOpen={isDefaultOpen}
      >
        <ul className="ms-3 border-l border-line ps-3">
          {value.map((child, index) => (
            <li key={index} className="min-w-0 py-0.5">
              <JsonNode name={String(index)} value={child} isDefaultOpen={false} />
            </li>
          ))}
        </ul>
      </JsonFold>
    );
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return (
      <span className="flex min-w-0 flex-wrap items-baseline gap-2">
        {name !== undefined && <span className="shrink-0 text-muted">{name}</span>}
        <JsonPrimitive value={value} />
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-2">
      {name !== undefined && <span className="shrink-0 text-muted">{name}</span>}
      <span className="font-mono text-muted">{JSON.stringify(value)}</span>
    </span>
  );
};

export const ContextTree = ({ context }: { context: Record<string, unknown> }) => {
  const [didCopy, setDidCopy] = useState(false);

  return (
    <section aria-label="Context" className="min-w-0">
      <div className="flex items-center justify-between gap-2 pb-2">
        <h3 className="text-xs font-semibold text-muted">Context</h3>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-xs text-muted',
            'hover:text-ink focus-visible:outline-2 focus-visible:outline-ink',
          )}
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(context, null, 2)).then(() => {
              setDidCopy(true);
              window.setTimeout(() => setDidCopy(false), 1500);
            });
          }}
        >
          {didCopy ? <CheckIcon size={12} aria-hidden /> : <CopyIcon size={12} aria-hidden />}
          {didCopy ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="font-mono text-[12px] leading-relaxed">
        <JsonNode value={context} isDefaultOpen />
      </div>
    </section>
  );
};
