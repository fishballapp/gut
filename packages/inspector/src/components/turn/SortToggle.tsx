import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { cn } from '@fishballapps/cn';
import type { OptionSort } from '../../lib/sort-options.ts';

const OPTIONS: { value: OptionSort; label: string }[] = [
  { value: 'as-sent', label: 'As sent' },
  { value: 'by-probability', label: 'By probability' },
];

/** As the model saw them, or highest probability first. */
export const SortToggle = ({
  value,
  onChange,
}: {
  value: OptionSort;
  onChange: (value: OptionSort) => void;
}) => (
  <ToggleGroup
    aria-label="Sort options"
    value={[value]}
    onValueChange={([next]) => {
      const chosen = OPTIONS.find(option => option.value === next);
      if (chosen !== undefined) onChange(chosen.value);
    }}
    className="inline-flex rounded-md border border-line p-0.5"
  >
    {OPTIONS.map(option => (
      <Toggle
        key={option.value}
        value={option.value}
        className={cn(
          'rounded-[5px] px-2.5 py-1 text-xs font-medium text-muted',
          'hover:text-ink data-[pressed]:bg-raised data-[pressed]:text-ink',
        )}
      >
        {option.label}
      </Toggle>
    ))}
  </ToggleGroup>
);
