import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import {
  CONFIG_FILES,
  type ConfigFile,
  type ModelForm,
  type ModelProblems,
} from '../../lib/model-form.ts';
import { TextField } from './FormFields.tsx';

const CONFIG_ORDER: ConfigFile[] = ['home', 'cwd', 'other'];

/** The gut config step: the default paths, or another file by its path. */
export const ConfigFields = ({
  form,
  update,
  problems,
}: {
  form: ModelForm;
  update: (patch: Partial<ModelForm>) => void;
  problems: ModelProblems;
}) => {
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
        <TextField
          label="Path to the config"
          placeholder="/path/to/gut.config.json"
          value={form.configPath}
          onChange={configPath => update({ configPath })}
          problem={problems.configPath}
        />
      )}
    </div>
  );
};
