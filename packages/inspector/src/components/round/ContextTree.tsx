import { Collapsible } from '@base-ui/react/collapsible';
import { cn } from '@fishballapps/cn';
import { CaretRightIcon } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A key as JSON writes it, with its colon. Array items are named by index. */
const KeyName = ({ name }: { name: string | undefined }) =>
  name === undefined ? null : <span className="text-muted">{`${name}: `}</span>;

const JsonPrimitive = ({ value }: { value: unknown }) => {
  if (typeof value === 'string') return <span className="text-ink">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="text-ink">{value}</span>;
  return <span className="text-muted">{JSON.stringify(value)}</span>;
};

/** The space a fold's caret takes, so a leaf's key lines up with its folded siblings' keys. */
const CARET_GUTTER = 'ps-[18px]';

const JsonFold = ({
  name,
  open,
  close,
  summary,
  isDefaultOpen,
  children,
}: {
  name?: string;
  open: string;
  close: string;
  /** What the fold holds, said while it is closed: `3 keys`. */
  summary: string;
  isDefaultOpen: boolean;
  children: ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(isDefaultOpen);
  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen} className="min-w-0">
      <Collapsible.Trigger className="flex w-full min-w-0 items-baseline gap-1.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ink">
        <CaretRightIcon
          size={12}
          weight="bold"
          className={cn(
            'relative top-px shrink-0 text-faint transition-transform motion-reduce:transition-none',
            isOpen && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="min-w-0 truncate">
          <KeyName name={name} />
          <span className="text-muted">{open}</span>
          {!isOpen && <span className="text-muted">{` ${summary} ${close}`}</span>}
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel>
        {children}
        <div className={cn(CARET_GUTTER, 'text-muted')}>{close}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
};

/** An object's keys or an array's items, named by index; undefined for a value with neither. */
const entriesOf = (value: unknown): [string, unknown][] | undefined => {
  if (isPlainObject(value)) return Object.entries(value);
  if (Array.isArray(value)) return value.map((child, index) => [String(index), child]);
  return undefined;
};

const count = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;

const JsonNode = ({
  name,
  value,
  isDefaultOpen = false,
}: {
  name?: string;
  value: unknown;
  isDefaultOpen?: boolean;
}) => {
  const entries = entriesOf(value);
  if (entries === undefined) {
    // One run of text, so a long value wraps under its key rather than onto a line of its own.
    return (
      <p className={cn(CARET_GUTTER, 'min-w-0 [overflow-wrap:anywhere]')}>
        <KeyName name={name} />
        <JsonPrimitive value={value} />
      </p>
    );
  }
  const isArray = Array.isArray(value);
  return (
    <JsonFold
      name={name}
      open={isArray ? '[' : '{'}
      close={isArray ? ']' : '}'}
      summary={isArray ? count(entries.length, 'item') : count(entries.length, 'key')}
      isDefaultOpen={isDefaultOpen}
    >
      <ul className="ms-[5px] border-l border-line ps-3">
        {entries.map(([key, child]) => (
          <li key={key} className="min-w-0 py-px">
            <JsonNode name={key} value={child} />
          </li>
        ))}
      </ul>
    </JsonFold>
  );
};

/** The context the task returned, as collapsible JSON: its top level open, everything below it folded. */
export const ContextTree = ({ context }: { context: Record<string, unknown> }) => (
  <div className="font-mono text-[12px] leading-relaxed">
    <JsonNode value={context} isDefaultOpen />
  </div>
);
