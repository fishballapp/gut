import { Select } from '@base-ui/react/select';
import { CaretUpDownIcon, CheckIcon } from '@phosphor-icons/react';
import {
  fixedEndpointOf,
  keyLabelOf,
  type ModelForm,
  type ModelProblems,
  modelListOf,
  PROVIDER_LABELS,
  PROVIDERS,
  type Provider,
} from '../../lib/model-form.ts';
import { Segmented, TextField } from './FormFields.tsx';

const selectTriggerClass =
  'flex h-8 min-w-0 items-center justify-between gap-2 rounded-md border border-line bg-ground px-2.5 font-mono text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-ink';

const PROVIDER_OPTIONS = PROVIDERS.map(provider => ({
  value: provider,
  label: PROVIDER_LABELS[provider],
}));

/** The model, endpoint and key for a hosted provider, a custom endpoint, or Ollama. */
export const ModelFields = ({
  form,
  update,
  problems,
  onProvider,
}: {
  form: ModelForm;
  update: (patch: Partial<ModelForm>) => void;
  problems: ModelProblems;
  onProvider: (provider: Provider) => void;
}) => {
  const list = modelListOf(form);
  const fixedEndpoint = fixedEndpointOf(form);
  const keyLabel = keyLabelOf(form);
  return (
    <div className="flex flex-col gap-3">
      {form.source === 'byok' && (
        <Segmented
          label="Provider"
          value={form.provider}
          options={PROVIDER_OPTIONS}
          onChange={onProvider}
        />
      )}

      {form.provider === 'cloudflare' && form.source === 'byok' && (
        <TextField
          label="Account ID"
          placeholder="From the Cloudflare dashboard"
          value={form.accountId}
          onChange={accountId => update({ accountId: accountId.toLowerCase() })}
          problem={problems.accountId}
        />
      )}

      {list === null ? (
        <TextField
          label="Model name"
          placeholder="clef-flash"
          value={form.name}
          onChange={name => update({ name })}
          problem={problems.name}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <Select.Root
            items={list.models.map(name => ({ label: name, value: name }))}
            value={form.name}
            onValueChange={name => {
              if (name !== null) update({ name });
            }}
          >
            <Select.Label className="text-[12px] font-medium text-muted">Model</Select.Label>
            <Select.Trigger className={selectTriggerClass}>
              <Select.Value />
              <Select.Icon>
                <CaretUpDownIcon size={14} />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner sideOffset={4}>
                <Select.Popup className="min-w-(--anchor-width) rounded-md border border-line bg-raised py-1 font-mono text-[13px] text-ink shadow-lg">
                  <Select.List>
                    {list.models.map(name => (
                      <Select.Item
                        key={name}
                        value={name}
                        className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 py-1.5 pr-3 pl-2 outline-hidden data-highlighted:bg-ink data-highlighted:text-ground"
                      >
                        <Select.ItemIndicator className="col-start-1">
                          <CheckIcon size={12} />
                        </Select.ItemIndicator>
                        <Select.ItemText className="col-start-2">{name}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.List>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
        </div>
      )}

      {fixedEndpoint !== null ? (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-muted">Endpoint</span>
          <span className="break-all font-mono text-[12px] text-muted">{fixedEndpoint}</span>
        </div>
      ) : (
        <TextField
          label="Endpoint"
          placeholder="http://localhost:11434/v1/systemone"
          value={form.endpoint}
          onChange={endpoint => update({ endpoint })}
          problem={problems.endpoint}
        />
      )}

      {list === null && (
        <TextField
          label="Options per question"
          placeholder="blank for 255"
          value={form.maxOptions}
          onChange={maxOptions => update({ maxOptions })}
          problem={problems.maxOptions}
        />
      )}

      {keyLabel !== null && (
        <div className="flex flex-col gap-1.5">
          <TextField
            label={keyLabel}
            type="password"
            autoComplete="off"
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
    </div>
  );
};
