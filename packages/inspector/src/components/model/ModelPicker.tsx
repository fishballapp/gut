import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import type { Action, ModelInfo } from '@gut.run/core/inspector';
import { XIcon } from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import {
  chooseProvider,
  chooseSource,
  forgetSent,
  formFor,
  MODEL_SOURCES,
  type ModelForm,
  type ModelProblems,
  type ModelSource,
  type Provider,
  readAction,
  SOURCE_LABELS,
} from '../../lib/model-form.ts';
import { ConfigFields } from './ConfigFields.tsx';
import { Segmented } from './FormFields.tsx';
import { ModelFields } from './ModelFields.tsx';

const secondaryButton =
  'h-8 rounded-md border border-line bg-raised px-3 text-[13px] font-medium text-ink hover:border-ink/40 disabled:opacity-60';

const primaryButton =
  'h-8 rounded-md border border-ink bg-ink px-3 text-[13px] font-medium text-ground hover:opacity-90 disabled:opacity-60';

const SOURCE_OPTIONS = MODEL_SOURCES.map(source => ({
  value: source,
  label: SOURCE_LABELS[source],
}));

/** The form inside the dialog: it mounts when the dialog opens, so closing drops whatever was typed. */
const PickerForm = ({
  model,
  act,
  onDone,
}: {
  model: ModelInfo | null;
  act: (action: Action) => Promise<ActOutcome>;
  onDone: () => void;
}) => {
  const [form, setForm] = useState<ModelForm>(() => formFor(model));
  const [problems, setProblems] = useState<ModelProblems>({});
  const [failure, setFailure] = useState<string | undefined>();
  const [isSending, setIsSending] = useState(false);

  // A message from the last send is about the form it was sent with, so any change clears it.
  const update = (patch: Partial<ModelForm>) => {
    setForm(current => ({ ...current, ...patch }));
    setFailure(undefined);
  };

  // A new source or provider starts its form afresh, so a key typed for another never goes along.
  const restart = (next: ModelForm) => {
    setForm(next);
    setProblems({});
    setFailure(undefined);
  };

  const send = async (action: Action) => {
    if (isSending) return;
    setFailure(undefined);
    // The key and a picked file's text have left the page with the request, so they are not kept.
    setForm(forgetSent);
    setIsSending(true);
    try {
      const outcome = await act(action);
      if (outcome.ok) {
        onDone();
        return;
      }
      setFailure(outcome.error);
    } catch {
      setFailure("Can't reach gut");
    } finally {
      setIsSending(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const read = readAction(form);
    if (!read.ok) {
      setProblems(read.problems);
      setFailure(undefined);
      return;
    }
    setProblems({});
    await send(read.action);
  };

  return (
    // Our own messages say what is wrong, so the browser's required bubbles stay off.
    <form noValidate onSubmit={save} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-muted">Source</span>
        <Segmented
          label="Decision model source"
          value={form.source}
          options={SOURCE_OPTIONS}
          onChange={(source: ModelSource) => restart(chooseSource(source))}
        />
      </div>

      {form.source === 'config' ? (
        <ConfigFields form={form} update={update} problems={problems} />
      ) : (
        <ModelFields
          form={form}
          update={update}
          problems={problems}
          onProvider={(provider: Provider) => restart(chooseProvider(provider))}
        />
      )}

      {failure !== undefined && (
        <p role="alert" className="whitespace-pre-line text-[12px] text-you">
          {failure}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {model !== null && (
          <Button
            type="button"
            disabled={isSending}
            onClick={() => void send({ type: 'clearModel' })}
            className={secondaryButton}
          >
            Clear
          </Button>
        )}
        <Button type="submit" disabled={isSending} className={primaryButton}>
          {form.source === 'config' ? 'Use this config' : 'Use this model'}
        </Button>
      </div>
    </form>
  );
};

/** Pick the decision model for runs that have none: a gut config's, one of ours, Ollama's, or any `/v1/systemone`. */
export const ModelPicker = ({
  model,
  act,
  onDone,
  returnsFocus,
}: {
  model: ModelInfo | null;
  act: (action: Action) => Promise<ActOutcome>;
  onDone: () => void;
  /** Whether closing hands focus back to the pill that opened it. */
  returnsFocus: () => boolean;
}) => (
  <Dialog.Portal>
    <Dialog.Backdrop className="fixed inset-0 bg-ground/70" />
    <Dialog.Popup
      finalFocus={returnsFocus}
      className="fixed top-1/2 left-1/2 flex max-h-[calc(100vh-2rem)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-raised p-6 shadow-lg"
    >
      <div className="flex items-start justify-between gap-4">
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
        <Dialog.Close
          aria-label="Close"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-ground hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
        >
          <XIcon size={16} />
        </Dialog.Close>
      </div>
      <PickerForm model={model} act={act} onDone={onDone} />
    </Dialog.Popup>
  </Dialog.Portal>
);
