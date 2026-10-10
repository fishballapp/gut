// The decision-model picker's form, as data: the source and provider chosen, the fields each one
// takes, and the action that sends them. Pure, so the dialog only renders and sends.
import type { Action, ModelInfo } from '@gut.run/core/inspector';

export type ModelSource = 'config' | 'byok' | 'ollama';

/** The providers a person brings a key for; `custom` takes any `/v1/systemone` endpoint. */
export type Provider = 'typesafe' | 'openrouter' | 'cloudflare' | 'custom';

/** Which gut config the config source reads: the two default paths, or a file the person names. */
export type ConfigFile = 'home' | 'cwd' | 'other';

export type ModelInput = Extract<Action, { type: 'setModel' }>['model'];

/** Everything the form holds as typed or chosen. The key is read here and never shown back. */
export type ModelForm = {
  source: ModelSource;
  provider: Provider;
  /** The model's name: picked from a provider's list, or typed for custom. */
  name: string;
  /** Cloudflare's account, which its endpoint sits under. */
  accountId: string;
  /** Ollama's endpoint (editable) or custom's. */
  endpoint: string;
  /** Custom's options per question; blank for the default. */
  maxOptions: string;
  apiKey: string;
  configFile: ConfigFile;
  /** The path typed for another config file. */
  configPath: string;
  /** A config file picked in the browser: its text, or why it can't be sent. */
  picked: PickedFile | null;
};

export type PickedFile = { name: string } & ({ text: string } | { problem: string });

export type ModelField =
  | 'accountId'
  | 'endpoint'
  | 'name'
  | 'maxOptions'
  | 'apiKey'
  | 'configPath'
  | 'configFile';

export type ModelProblems = Partial<Record<ModelField, string>>;

export type ReadAction = { ok: true; action: Action } | { ok: false; problems: ModelProblems };

/** The sources in the order the dialog lists them. */
export const MODEL_SOURCES: ModelSource[] = ['config', 'byok', 'ollama'];

export const SOURCE_LABELS: Record<ModelSource, string> = {
  config: 'gut config',
  byok: 'Bring your own key',
  ollama: 'Ollama',
};

export const CONFIG_FILES: Record<ConfigFile, { label: string; detail: string }> = {
  home: { label: '~/gut.config.json', detail: 'In your home folder' },
  cwd: { label: './gut.config.json', detail: 'In the folder gut started from' },
  other: { label: 'Another file', detail: 'An absolute path, or a file you pick' },
};

const CONFIG_PATHS = { home: '~/gut.config.json', cwd: './gut.config.json' } as const;

/** The providers in the order the pills show them; Jev on TypeSafe is the default. */
export const PROVIDERS: Provider[] = ['typesafe', 'openrouter', 'cloudflare', 'custom'];

export const PROVIDER_LABELS: Record<Provider, string> = {
  typesafe: 'TypeSafe',
  openrouter: 'OpenRouter',
  cloudflare: 'Cloudflare',
  custom: 'Custom',
};

/** A provider's models, never empty: a new model starts on the first. */
type Models = readonly [string, ...string[]];

type Hosted = {
  keyLabel: string;
  models: Models;
  maxOptions: number;
  endpointOf: (accountId: string, name: string) => string;
};

type HostedProvider = Exclude<Provider, 'custom'>;

/** Each hosted provider's endpoint, models and key. OpenAI is not here: its decisions API is not `/v1/systemone`. */
const HOSTED: Record<HostedProvider, Hosted> = {
  typesafe: {
    keyLabel: 'TypeSafe API key',
    models: ['jev-latest', 'jev-preview', 'jev-1.13.0'],
    maxOptions: 255,
    endpointOf: () => 'https://api.typesafe.ai/v1/systemone',
  },
  openrouter: {
    keyLabel: 'OpenRouter API key',
    models: ['~typesafe/jev-latest', 'typesafe/jev-1.13'],
    maxOptions: 255,
    endpointOf: () => 'https://openrouter.ai/api/v1/systemone',
  },
  cloudflare: {
    keyLabel: 'Cloudflare API token',
    models: ['clef-flash', 'clef'],
    maxOptions: 255,
    endpointOf: (accountId, name) =>
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/cloudflare/${name}`,
  },
};

const OLLAMA: { endpoint: string; models: Models; maxOptions: number } = {
  endpoint: 'http://localhost:11434/v1/systemone',
  models: ['clef-flash', 'clef'],
  maxOptions: 26,
};

const SYSTEMONE_PATH = '/v1/systemone';

const CLOUDFLARE_ENDPOINT =
  /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/(?<accountId>[0-9a-f]{32})\/ai\/run\/@cf\/cloudflare\/(?<name>[\w.-]+)$/i;

/** Cloudflare's account IDs are 32 hex characters; the ID goes into the endpoint's path, so it is checked. */
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

/** Account IDs are kept lowercase, so an endpoint saved with one reopens as the same provider. */
export const normalizeAccountId = (text: string): string => text.trim().toLowerCase();

/** A gut config picked in the browser is sent as text, and the server takes at most 64 KiB of request. */
export const MAX_CONFIG_BYTES = 32 * 1024;

/** Reads a picked file for the form; a file that is too big or can't be read says so instead. */
export const pickedFileOf = async (file: File): Promise<PickedFile> => {
  if (file.size > MAX_CONFIG_BYTES) {
    return { name: file.name, problem: `${file.name} is over 32 KiB, too big for a gut config` };
  }
  try {
    return { name: file.name, text: await file.text() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { name: file.name, problem: `Couldn't read ${file.name}: ${reason}` };
  }
};

/** What the form keeps once its action is sent: the key and the picked file's text leave with it. */
export const forgetSent = (form: ModelForm): ModelForm => ({ ...form, apiKey: '', picked: null });

/** A fresh form for a source and provider: the source's first model, and nothing typed. */
const freshForm = (source: ModelSource, provider: Provider): ModelForm => {
  const blank: ModelForm = {
    source,
    provider,
    name: '',
    accountId: '',
    endpoint: '',
    maxOptions: '',
    apiKey: '',
    configFile: 'home',
    configPath: '',
    picked: null,
  };
  if (source === 'config') return blank;
  if (source === 'ollama') return { ...blank, name: OLLAMA.models[0], endpoint: OLLAMA.endpoint };
  if (provider === 'custom') return blank;
  return { ...blank, name: HOSTED[provider].models[0] };
};

/** Choosing a source starts its form afresh, so nothing typed for another source is kept or sent. */
export const chooseSource = (source: ModelSource): ModelForm => freshForm(source, 'typesafe');

/** Choosing a provider starts its form afresh, so a key typed for one provider never reaches another. */
export const chooseProvider = (provider: Provider): ModelForm => freshForm('byok', provider);

/** A model that matches a named provider's endpoint, models and option limit, opens on that provider. */
const presetForm = ({ endpoint, name, maxOptions }: ModelInfo): ModelForm | null => {
  if (endpoint === OLLAMA.endpoint && maxOptions === OLLAMA.maxOptions) {
    return OLLAMA.models.includes(name) ? { ...freshForm('ollama', 'custom'), name } : null;
  }
  const cloudflare = CLOUDFLARE_ENDPOINT.exec(endpoint)?.groups;
  if (cloudflare !== undefined && cloudflare.name === name && maxOptions === 255) {
    const accountId = normalizeAccountId(cloudflare.accountId ?? '');
    return { ...freshForm('byok', 'cloudflare'), accountId, name };
  }
  const fixed = (['typesafe', 'openrouter'] as const).find(
    provider =>
      HOSTED[provider].endpointOf('', name) === endpoint &&
      HOSTED[provider].models.includes(name) &&
      HOSTED[provider].maxOptions === maxOptions,
  );
  return fixed === undefined ? null : { ...freshForm('byok', fixed), name };
};

/** The form a picker opens with: the page's model's settings if it has one, else Jev on TypeSafe. */
export const formFor = (model: ModelInfo | null): ModelForm => {
  if (model === null) return freshForm('byok', 'typesafe');
  return (
    presetForm(model) ?? {
      ...freshForm('byok', 'custom'),
      endpoint: model.endpoint,
      name: model.name,
      maxOptions: String(model.maxOptions),
    }
  );
};

/** The endpoint a hosted provider serves the model at, shown read-only; `null` where the endpoint is typed. */
export const fixedEndpointOf = (form: ModelForm): string | null => {
  if (form.source === 'ollama' || form.provider === 'custom') return null;
  return HOSTED[form.provider].endpointOf(
    normalizeAccountId(form.accountId) || '<account id>',
    form.name,
  );
};

/** The models a hosted provider or Ollama offers, and the option limit each takes; `null` for custom, whose name is typed. */
export const modelListOf = (
  form: ModelForm,
): { models: readonly string[]; maxOptions: number } | null => {
  if (form.source === 'ollama') return OLLAMA;
  if (form.provider === 'custom') return null;
  return HOSTED[form.provider];
};

/** Keys a hosted provider takes, labelled as the key field is. */
export const keyLabelOf = (form: ModelForm): string | null => {
  if (form.source === 'ollama') return null;
  if (form.provider === 'custom') return 'API key (optional)';
  return HOSTED[form.provider].keyLabel;
};

/** A `/v1/systemone` endpoint: an http(s) URL whose path ends there (a query or hash may follow). */
const isSystemoneEndpoint = (endpoint: string): boolean => {
  if (!URL.canParse(endpoint)) return false;
  const url = new URL(endpoint);
  return ['http:', 'https:'].includes(url.protocol) && url.pathname.endsWith(SYSTEMONE_PATH);
};

const endpointProblems = (endpoint: string): ModelProblems =>
  isSystemoneEndpoint(endpoint)
    ? {}
    : {
        endpoint: `Must be an http(s) URL ending in ${SYSTEMONE_PATH}, as in http://localhost:11434${SYSTEMONE_PATH}`,
      };

const isOptionCount = (text: string): boolean => /^\d+$/.test(text) && Number(text) >= 2;

const customProblems = (form: ModelForm): ModelProblems => {
  const name = form.name.trim();
  const maxOptions = form.maxOptions.trim();
  return {
    ...endpointProblems(form.endpoint.trim()),
    ...(name === '' ? { name: 'Enter the model name' } : {}),
    ...(maxOptions === '' || isOptionCount(maxOptions)
      ? {}
      : { maxOptions: 'A whole number of 2 or more, or blank for the default' }),
  };
};

const modelProblems = (form: ModelForm): ModelProblems => {
  if (form.source === 'ollama') return endpointProblems(form.endpoint.trim());
  if (form.provider === 'custom') return customProblems(form);
  return {
    ...(form.apiKey.trim() === '' ? { apiKey: `Enter the ${HOSTED[form.provider].keyLabel}` } : {}),
    ...(form.provider === 'cloudflare' && !ACCOUNT_ID.test(normalizeAccountId(form.accountId))
      ? { accountId: 'Enter the account ID from the Cloudflare dashboard, 32 hex characters' }
      : {}),
  };
};

const modelOf = (form: ModelForm): ModelInput => {
  if (form.source === 'ollama') {
    return { endpoint: form.endpoint.trim(), name: form.name, maxOptions: OLLAMA.maxOptions };
  }
  const apiKey = form.apiKey.trim();
  const keyField = apiKey === '' ? {} : { apiKey };
  if (form.provider === 'custom') {
    const maxOptions = form.maxOptions.trim();
    return {
      endpoint: form.endpoint.trim(),
      name: form.name.trim(),
      ...keyField,
      ...(maxOptions === '' ? {} : { maxOptions: Number(maxOptions) }),
    };
  }
  const hosted = HOSTED[form.provider];
  return {
    endpoint: hosted.endpointOf(normalizeAccountId(form.accountId), form.name),
    name: form.name,
    maxOptions: hosted.maxOptions,
    ...keyField,
  };
};

const readConfigAction = (form: ModelForm): ReadAction => {
  if (form.configFile === 'home' || form.configFile === 'cwd') {
    const path = CONFIG_PATHS[form.configFile];
    return { ok: true, action: { type: 'loadConfig', from: { kind: 'path', path } } };
  }
  if (form.picked !== null && 'problem' in form.picked) {
    return { ok: false, problems: { configFile: form.picked.problem } };
  }
  if (form.picked !== null && 'text' in form.picked) {
    return {
      ok: true,
      action: { type: 'loadConfig', from: { kind: 'text', text: form.picked.text } },
    };
  }
  const path = form.configPath.trim();
  if (path === '') {
    return {
      ok: false,
      problems: { configPath: 'Enter the path to a gut config, or pick a file' },
    };
  }
  return { ok: true, action: { type: 'loadConfig', from: { kind: 'path', path } } };
};

/** The action the form sends, or what is wrong with it. A key is read here, never shown back. */
export const readAction = (form: ModelForm): ReadAction => {
  if (form.source === 'config') return readConfigAction(form);
  const problems = modelProblems(form);
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, action: { type: 'setModel', model: modelOf(form) } };
};
