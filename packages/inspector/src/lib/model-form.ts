// The model picker's choices, the form behind them, and what it sends as `setModel`. Pure, so the
// dialog only renders and sends.
import type { Action, ModelInfo } from '@gut.run/core/inspector';

export type ModelChoice = 'jev' | 'clef' | 'custom';

/** The choices in the order the picker lists them. */
export const MODEL_CHOICES: ModelChoice[] = ['jev', 'clef', 'custom'];

export type ModelInput = Extract<Action, { type: 'setModel' }>['model'];

type Preset = { endpoint: string; name: string; maxOptions: number };

type ChoiceRow = {
  label: string;
  detail: string;
  keyLabel: string;
  /** Whether the choice takes a key: Jev does, a local Ollama does not. */
  key: 'required' | 'optional' | 'none';
  /** Fixed for a named choice; `null` for the custom endpoint, whose fields are typed. */
  preset: Preset | null;
};

const SYSTEMONE_PATH = '/v1/systemone';

const CHOICES: Record<ModelChoice, ChoiceRow> = {
  jev: {
    label: 'Jev on OpenRouter',
    detail: '~typesafe/jev-latest · takes up to 255 options',
    keyLabel: 'OpenRouter API key',
    key: 'required',
    preset: {
      endpoint: 'https://openrouter.ai/api/v1/systemone',
      name: '~typesafe/jev-latest',
      maxOptions: 255,
    },
  },
  clef: {
    label: 'Clef on a local Ollama',
    detail: 'clef-flash · takes up to 26 options',
    keyLabel: 'API key',
    key: 'none',
    preset: { endpoint: 'http://localhost:11434/v1/systemone', name: 'clef-flash', maxOptions: 26 },
  },
  custom: {
    label: 'Any /v1/systemone endpoint',
    detail: 'endpoint, model name and key',
    keyLabel: 'API key (optional)',
    key: 'optional',
    preset: null,
  },
};

export const choiceRow = (choice: ModelChoice): ChoiceRow => CHOICES[choice];

/** The form's text, as typed. Only the custom choice's endpoint, name and options are read. */
export type ModelForm = {
  choice: ModelChoice;
  endpoint: string;
  name: string;
  maxOptions: string;
  apiKey: string;
};

export type ModelField = 'endpoint' | 'name' | 'maxOptions' | 'apiKey';

export type ModelProblems = Partial<Record<ModelField, string>>;

export type ReadModel = { ok: true; model: ModelInput } | { ok: false; problems: ModelProblems };

const choiceOf = (model: ModelInfo | null): ModelChoice => {
  if (model === null) return 'jev';
  return (
    MODEL_CHOICES.find(choice => {
      const preset = CHOICES[choice].preset;
      return (
        preset !== null &&
        preset.endpoint === model.endpoint &&
        preset.name === model.name &&
        preset.maxOptions === model.maxOptions
      );
    }) ?? 'custom'
  );
};

/** Switching choice clears the key: a key typed for one provider is never sent to another. */
export const chooseChoice = (form: ModelForm, choice: ModelChoice): ModelForm => ({
  ...form,
  choice,
  apiKey: '',
});

/** The form a picker opens with: the page's model if it has one, else Jev. */
export const formFor = (model: ModelInfo | null): ModelForm => ({
  choice: choiceOf(model),
  endpoint: model?.endpoint ?? '',
  name: model?.name ?? '',
  maxOptions: model === null ? '' : String(model.maxOptions),
  apiKey: '',
});

/** A `/v1/systemone` endpoint: an http(s) URL whose path ends there (a query or hash may follow). */
const isSystemoneEndpoint = (endpoint: string): boolean => {
  if (!URL.canParse(endpoint)) return false;
  const url = new URL(endpoint);
  return ['http:', 'https:'].includes(url.protocol) && url.pathname.endsWith(SYSTEMONE_PATH);
};

const isOptionCount = (text: string): boolean => /^\d+$/.test(text) && Number(text) >= 2;

const customProblems = (form: ModelForm): ModelProblems => {
  const endpoint = form.endpoint.trim();
  const name = form.name.trim();
  const maxOptions = form.maxOptions.trim();
  return {
    ...(isSystemoneEndpoint(endpoint)
      ? {}
      : {
          endpoint: `Must be an http(s) URL ending in ${SYSTEMONE_PATH}, as in http://localhost:11434${SYSTEMONE_PATH}`,
        }),
    ...(name === '' ? { name: 'Enter the model name' } : {}),
    ...(maxOptions === '' || isOptionCount(maxOptions)
      ? {}
      : { maxOptions: 'A whole number of 2 or more, or blank for the default' }),
  };
};

const problemsOf = (form: ModelForm): ModelProblems => {
  const { preset, key } = CHOICES[form.choice];
  if (preset !== null) {
    return key === 'required' && form.apiKey.trim() === '' ? { apiKey: 'Enter the API key' } : {};
  }
  return customProblems(form);
};

const modelOf = (form: ModelForm): ModelInput => {
  const { preset, key } = CHOICES[form.choice];
  const apiKey = key === 'none' ? '' : form.apiKey.trim();
  const keyField = apiKey === '' ? {} : { apiKey };
  if (preset !== null) {
    return {
      endpoint: preset.endpoint,
      name: preset.name,
      maxOptions: preset.maxOptions,
      ...keyField,
    };
  }
  const maxOptions = form.maxOptions.trim();
  return {
    endpoint: form.endpoint.trim(),
    name: form.name.trim(),
    ...keyField,
    ...(maxOptions === '' ? {} : { maxOptions: Number(maxOptions) }),
  };
};

/** The model to send, or what is wrong with the form. A key is read here, never shown back. */
export const readModel = (form: ModelForm): ReadModel => {
  const problems = problemsOf(form);
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, model: modelOf(form) };
};
