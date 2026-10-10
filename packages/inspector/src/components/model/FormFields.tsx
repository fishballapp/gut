import { Field } from '@base-ui/react/field';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';

export const inputClass =
  'h-8 min-w-0 rounded-md border border-line bg-ground px-2.5 font-mono text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-ink data-[invalid]:border-you';

/** One labelled text field; the problem, if any, is shown under it. */
export const TextField = ({
  label,
  problem,
  value,
  onChange,
  ...inputProps
}: {
  label: string;
  problem: string | undefined;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  placeholder?: string;
  autoComplete?: string;
}) => (
  <Field.Root invalid={problem !== undefined} className="flex min-w-0 flex-1 flex-col gap-1">
    <Field.Label className="text-[12px] font-medium text-muted">{label}</Field.Label>
    <Field.Control
      {...inputProps}
      value={value}
      className={inputClass}
      onChange={event => onChange(event.target.value)}
    />
    {problem !== undefined && (
      <Field.Error match className="text-[12px] text-you">
        {problem}
      </Field.Error>
    )}
  </Field.Root>
);

/** Choices as a split control, so the one picked reads as the one in use. */
export const Segmented = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) => (
  <RadioGroup
    value={value}
    onValueChange={(next: T) => onChange(next)}
    aria-label={label}
    className="flex rounded-lg border border-line bg-ground p-0.5"
  >
    {options.map(option => (
      <Radio.Root
        key={option.value}
        value={option.value}
        className="flex-1 rounded-md px-2 py-1 text-center text-[13px] font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink data-[checked]:bg-raised data-[checked]:text-ink data-[checked]:shadow-sm"
      >
        {option.label}
      </Radio.Root>
    ))}
  </RadioGroup>
);
