import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { Field } from '@base-ui/react/field';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import type { Action, ModelInfo } from '@gut.run/core/inspector';
import { type FormEvent, useState } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import {
  choiceRow,
  chooseChoice,
  formFor,
  MODEL_CHOICES,
  type ModelChoice,
  type ModelForm,
  type ModelProblems,
  readModel,
} from '../../lib/model-form.ts';

const inputClass =
  'h-8 rounded-md border border-line bg-ground px-2.5 font-mono text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-ink data-[invalid]:border-you';

const ChoiceCard = ({ choice }: { choice: ModelChoice }) => {
  const row = choiceRow(choice);
  return (
    <Radio.Root
      value={choice}
      className="group flex w-full items-start gap-3 rounded-lg border border-line bg-ground px-3.5 py-3 text-left focus-visible:outline-2 focus-visible:outline-ink data-[checked]:border-ink"
    >
      <span className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border border-muted group-data-[checked]:border-ink">
        <span className="size-2 rounded-full group-data-[checked]:bg-ink" />
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] font-medium text-ink">{row.label}</span>
        <span className="font-mono text-[12px] text-muted">{row.detail}</span>
      </span>
    </Radio.Root>
  );
};

/** One labelled text field; the problem, if any, is shown under it. */
const TextField = ({
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
  required?: boolean;
  autoComplete?: string;
}) => (
  <Field.Root invalid={problem !== undefined} className="flex flex-col gap-1">
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

/** The form inside the dialog: it mounts when the dialog opens, so closing drops whatever was typed. */
const PickerForm = ({
  model,
  act,
  onSaved,
}: {
  model: ModelInfo | null;
  act: (action: Action) => Promise<ActOutcome>;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState<ModelForm>(() => formFor(model));
  const [problems, setProblems] = useState<ModelProblems>({});
  const [failure, setFailure] = useState<string | undefined>();
  const [isSending, setIsSending] = useState(false);
  const row = choiceRow(form.choice);
  const isCustom = row.preset === null;

  const update = (patch: Partial<ModelForm>) => setForm(current => ({ ...current, ...patch }));

  const chooseModel = (choice: ModelChoice) => {
    setForm(current => chooseChoice(current, choice));
    setProblems({});
    setFailure(undefined);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSending) return;
    const read = readModel(form);
    if (!read.ok) {
      setProblems(read.problems);
      setFailure(undefined);
      return;
    }
    setProblems({});
    setFailure(undefined);
    setIsSending(true);
    // The key has left the page with the request; it is not kept in state after this.
    update({ apiKey: '' });
    try {
      const outcome = await act({ type: 'setModel', model: read.model });
      if (outcome.ok) {
        onSaved();
        return;
      }
      setFailure(outcome.error);
    } catch {
      setFailure("Can't reach gut");
    } finally {
      setIsSending(false);
    }
  };

  return (
    // Our own messages say what is wrong, so the browser's required bubbles stay off.
    <form noValidate onSubmit={save} className="flex flex-col gap-4">
      <RadioGroup
        value={form.choice}
        onValueChange={(choice: ModelChoice) => chooseModel(choice)}
        aria-label="Decision model"
        className="flex flex-col gap-2"
      >
        {MODEL_CHOICES.map(choice => (
          <ChoiceCard key={choice} choice={choice} />
        ))}
      </RadioGroup>

      {row.key !== 'none' && (
        <div className="flex flex-col gap-1.5">
          <TextField
            label={row.keyLabel}
            type="password"
            autoComplete="off"
            required={row.key === 'required'}
            value={form.apiKey}
            onChange={apiKey => update({ apiKey })}
            problem={problems.apiKey}
          />
          <p className="text-[12px] text-muted">
            The key goes to the gut process on this machine only. It is held in memory and never
            stored by this page.
          </p>
        </div>
      )}

      {isCustom && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <TextField
              label="Endpoint"
              placeholder="http://localhost:11434/v1/systemone"
              required
              value={form.endpoint}
              onChange={endpoint => update({ endpoint })}
              problem={problems.endpoint}
            />
          </div>
          <TextField
            label="Model name"
            placeholder="clef-flash"
            required
            value={form.name}
            onChange={name => update({ name })}
            problem={problems.name}
          />
          <TextField
            label="Options per question"
            placeholder="blank for 255"
            value={form.maxOptions}
            onChange={maxOptions => update({ maxOptions })}
            problem={problems.maxOptions}
          />
        </div>
      )}

      {failure !== undefined && (
        <p role="alert" className="whitespace-pre-line text-[12px] text-you">
          {failure}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Dialog.Close className="h-8 rounded-md border border-line bg-raised px-3 text-[13px] font-medium text-ink hover:border-ink/40">
          Not now
        </Dialog.Close>
        <Button
          type="submit"
          disabled={isSending}
          className="h-8 rounded-md border border-ink bg-ink px-3 text-[13px] font-medium text-ground hover:opacity-90 disabled:opacity-60"
        >
          Use this model
        </Button>
      </div>
    </form>
  );
};

/** Pick the model a run without its own uses: Jev, Clef on Ollama, or any `/v1/systemone` endpoint. */
export const ModelPicker = ({
  model,
  act,
  onSaved,
}: {
  model: ModelInfo | null;
  act: (action: Action) => Promise<ActOutcome>;
  onSaved: () => void;
}) => (
  <Dialog.Portal>
    <Dialog.Backdrop className="fixed inset-0 bg-ground/70" />
    <Dialog.Popup className="fixed top-1/2 left-1/2 flex w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-line bg-raised p-6 shadow-lg">
      <div className="flex flex-col gap-1">
        <Dialog.Title className="text-[18px] font-semibold text-ink">
          {model === null ? 'Add a decision model' : 'Change the decision model'}
        </Dialog.Title>
        <Dialog.Description className="text-[13px] text-muted">
          {model === null
            ? 'Play and Ask model need one. Without it, you answer every turn.'
            : 'Runs without their own model use this one.'}
        </Dialog.Description>
      </div>
      <PickerForm model={model} act={act} onSaved={onSaved} />
    </Dialog.Popup>
  </Dialog.Portal>
);
