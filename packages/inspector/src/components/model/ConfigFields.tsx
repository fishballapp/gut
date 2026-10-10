import { Button } from '@base-ui/react/button';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { useRef } from 'react';
import {
  CONFIG_FILES,
  type ConfigFile,
  type ModelForm,
  type ModelProblems,
  pickedFileOf,
} from '../../lib/model-form.ts';
import { TextField } from './FormFields.tsx';

const CONFIG_ORDER: ConfigFile[] = ['home', 'cwd', 'other'];

/** The gut config step: the default paths, or another file, typed as a path or picked in the browser. */
export const ConfigFields = ({
  form,
  update,
  problems,
}: {
  form: ModelForm;
  update: (patch: Partial<ModelForm>) => void;
  problems: ModelProblems;
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        value={form.configFile}
        onValueChange={(configFile: ConfigFile) => update({ configFile })}
        aria-label="Gut config file"
        className="flex flex-col gap-0.5"
      >
        {CONFIG_ORDER.map(configFile => (
          <Radio.Root
            key={configFile}
            value={configFile}
            className="group flex items-center gap-2.5 rounded-md px-1 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ink"
          >
            <span className="grid size-4 shrink-0 place-items-center rounded-full border border-muted group-data-[checked]:border-ink">
              <span className="size-2 rounded-full group-data-[checked]:bg-ink" />
            </span>
            <span className="font-mono text-[13px] text-ink">{CONFIG_FILES[configFile].label}</span>
            <span className="text-[12px] text-muted">{CONFIG_FILES[configFile].detail}</span>
          </Radio.Root>
        ))}
      </RadioGroup>

      {form.configFile === 'other' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-end gap-2">
            <TextField
              label="Absolute path to the config"
              placeholder="/path/to/gut.config.json"
              value={form.configPath}
              onChange={configPath => update({ configPath, picked: null })}
              problem={problems.configPath}
            />
            <Button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-8 shrink-0 rounded-md border border-line bg-raised px-3 text-[13px] font-medium text-ink hover:border-ink/40"
            >
              Choose file…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async event => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (file === undefined) return;
                update({ picked: await pickedFileOf(file), configPath: '' });
                // Cleared so that choosing the same file again still fires a change.
                input.value = '';
              }}
            />
          </div>
          {form.picked !== null &&
            ('problem' in form.picked ? (
              <p role="alert" className="text-[12px] text-you">
                {form.picked.problem}
              </p>
            ) : (
              <p className="text-[12px] text-muted">Using {form.picked.name}</p>
            ))}
        </div>
      )}
    </div>
  );
};
