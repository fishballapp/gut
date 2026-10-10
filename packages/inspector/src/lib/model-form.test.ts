import type { ModelInfo } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import {
  chooseProvider,
  chooseSource,
  forgetSent,
  formFor,
  type ModelForm,
  type ModelProblems,
  readAction,
} from './model-form.ts';

const formOf = (overrides: Partial<ModelForm>): ModelForm => ({
  ...chooseProvider('custom'),
  ...overrides,
});

const CLEF: ModelInfo = {
  name: 'clef-flash',
  endpoint: 'http://localhost:11434/v1/systemone',
  maxOptions: 26,
};

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';

const problemsOf = (form: ModelForm): ModelProblems => {
  const read = readAction(form);
  if (read.ok) throw new Error('expected the form to have problems');
  return read.problems;
};

describe('formFor', () => {
  it('opens on Jev on TypeSafe when the page has no model', () => {
    expect(formFor(null)).toMatchObject({
      source: 'byok',
      provider: 'typesafe',
      name: 'jev-latest',
      apiKey: '',
    });
  });

  it('opens on Ollama when the page model is Clef on the local Ollama', () => {
    expect(formFor(CLEF)).toMatchObject({
      source: 'ollama',
      name: 'clef-flash',
      endpoint: 'http://localhost:11434/v1/systemone',
    });
  });

  it('opens on the hosted provider a page model is served by', () => {
    const openRouter: ModelInfo = {
      name: 'typesafe/jev-1.13',
      endpoint: 'https://openrouter.ai/api/v1/systemone',
      maxOptions: 255,
    };
    expect(formFor(openRouter)).toMatchObject({
      source: 'byok',
      provider: 'openrouter',
      name: 'typesafe/jev-1.13',
    });
  });

  it('reads the account out of a Cloudflare endpoint', () => {
    const cloudflare: ModelInfo = {
      name: 'clef',
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`,
      maxOptions: 255,
    };
    expect(formFor(cloudflare)).toMatchObject({
      source: 'byok',
      provider: 'cloudflare',
      accountId: ACCOUNT_ID,
      name: 'clef',
    });
  });

  it('opens a model that matches no provider as custom, filled in', () => {
    const other: ModelInfo = { name: 'x', endpoint: 'http://h:1/v1/systemone', maxOptions: 9 };
    expect(formFor(other)).toMatchObject({
      source: 'byok',
      provider: 'custom',
      endpoint: 'http://h:1/v1/systemone',
      name: 'x',
      maxOptions: '9',
    });
  });

  it('keeps a named model with a different option limit as custom', () => {
    const smaller: ModelInfo = { ...CLEF, maxOptions: 9 };
    expect(formFor(smaller)).toMatchObject({ source: 'byok', provider: 'custom', maxOptions: '9' });
  });
});

describe('chooseSource and chooseProvider', () => {
  it('clears the key when the source changes, so it never reaches another source', () => {
    const typed = formOf({ apiKey: 'sk-secret' });
    expect(chooseSource('ollama').apiKey).toBe('');
    expect(typed.apiKey).toBe('sk-secret');
  });

  it('clears the key when the provider changes, so it never reaches another provider', () => {
    const typed = formOf({ provider: 'openrouter', apiKey: 'sk-or-secret' });
    expect(chooseProvider('typesafe')).toMatchObject({ provider: 'typesafe', apiKey: '' });
    expect(typed.apiKey).toBe('sk-or-secret');
  });

  it('starts a provider on its first model', () => {
    expect(chooseProvider('openrouter')).toMatchObject({ name: '~typesafe/jev-latest' });
    expect(chooseProvider('cloudflare')).toMatchObject({ name: 'clef-flash' });
  });

  it('starts Ollama on clef-flash at its endpoint', () => {
    expect(chooseSource('ollama')).toMatchObject({
      name: 'clef-flash',
      endpoint: 'http://localhost:11434/v1/systemone',
    });
  });
});

describe('readAction for a config', () => {
  it('sends ~/gut.config.json as a path', () => {
    expect(readAction({ ...chooseSource('config'), configFile: 'home' })).toEqual({
      ok: true,
      action: { type: 'loadConfig', path: '~/gut.config.json' },
    });
  });

  it('sends ./gut.config.json as a path, which the CLI reads from where gut started', () => {
    expect(readAction({ ...chooseSource('config'), configFile: 'cwd' })).toEqual({
      ok: true,
      action: { type: 'loadConfig', path: './gut.config.json' },
    });
  });

  it('sends a typed absolute path', () => {
    const form = {
      ...chooseSource('config'),
      configFile: 'other' as const,
      configPath: ' /a/gut.json ',
    };
    expect(readAction(form)).toEqual({
      ok: true,
      action: { type: 'loadConfig', path: '/a/gut.json' },
    });
  });

  it('asks for a path when another file has none typed', () => {
    const form = { ...chooseSource('config'), configFile: 'other' as const };
    expect(problemsOf(form)).toEqual({
      configPath: 'Enter the path to a gut config',
    });
  });
});

describe('readAction for a hosted provider', () => {
  it('sends Jev on TypeSafe with its endpoint, model, limit and key', () => {
    const form = { ...chooseProvider('typesafe'), apiKey: ' tk-1 ' };
    expect(readAction(form)).toEqual({
      ok: true,
      action: {
        type: 'setModel',
        model: {
          endpoint: 'https://api.typesafe.ai/v1/systemone',
          name: 'jev-latest',
          maxOptions: 255,
          apiKey: 'tk-1',
        },
      },
    });
  });

  it('sends OpenRouter with its endpoint', () => {
    const form = { ...chooseProvider('openrouter'), apiKey: 'sk-or' };
    expect(readAction(form)).toMatchObject({
      ok: true,
      action: {
        model: { endpoint: 'https://openrouter.ai/api/v1/systemone', name: '~typesafe/jev-latest' },
      },
    });
  });

  it('asks for the key, which every hosted provider takes', () => {
    expect(problemsOf(chooseProvider('typesafe'))).toEqual({
      apiKey: 'Enter the TypeSafe API key',
    });
  });

  it('builds the Cloudflare endpoint from the account and the model, and sends the model as the name', () => {
    const form = {
      ...chooseProvider('cloudflare'),
      accountId: ACCOUNT_ID,
      name: 'clef',
      apiKey: 'cf-token',
    };
    expect(readAction(form)).toEqual({
      ok: true,
      action: {
        type: 'setModel',
        model: {
          endpoint: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`,
          name: 'clef',
          maxOptions: 255,
          apiKey: 'cf-token',
        },
      },
    });
  });

  it('asks for an account ID that is 32 hex characters, since it goes into the endpoint path', () => {
    const form = { ...chooseProvider('cloudflare'), accountId: 'a/b', apiKey: 'cf-token' };
    expect(problemsOf(form)).toEqual({
      accountId: 'Enter the account ID from the Cloudflare dashboard, 32 hex characters',
    });
  });
});

describe('readAction for Ollama', () => {
  it('sends Clef on the local Ollama with no key', () => {
    expect(readAction({ ...chooseSource('ollama'), name: 'clef' })).toEqual({
      ok: true,
      action: {
        type: 'setModel',
        model: { endpoint: 'http://localhost:11434/v1/systemone', name: 'clef', maxOptions: 26 },
      },
    });
  });

  it('sends an edited endpoint', () => {
    const form = { ...chooseSource('ollama'), endpoint: ' http://10.0.0.2:11434/v1/systemone ' };
    expect(readAction(form)).toMatchObject({
      ok: true,
      action: { model: { endpoint: 'http://10.0.0.2:11434/v1/systemone' } },
    });
  });

  it('asks for an endpoint that ends in /v1/systemone', () => {
    const form = { ...chooseSource('ollama'), endpoint: 'http://localhost:11434' };
    expect(Object.keys(problemsOf(form))).toEqual(['endpoint']);
  });
});

describe('readAction for a custom endpoint', () => {
  const custom = chooseProvider('custom');

  it('sends the typed endpoint, name and options, and the key if there is one', () => {
    const form = formOf({
      ...custom,
      endpoint: 'http://h:1/v1/systemone?x=1',
      name: ' m ',
      maxOptions: '9',
      apiKey: 'k',
    });
    expect(readAction(form)).toEqual({
      ok: true,
      action: {
        type: 'setModel',
        model: { endpoint: 'http://h:1/v1/systemone?x=1', name: 'm', maxOptions: 9, apiKey: 'k' },
      },
    });
  });

  it('leaves the key and the options out when they are blank', () => {
    const form = formOf({ ...custom, endpoint: 'https://h/v1/systemone', name: 'm' });
    expect(readAction(form)).toEqual({
      ok: true,
      action: { type: 'setModel', model: { endpoint: 'https://h/v1/systemone', name: 'm' } },
    });
  });

  it('reads the endpoint path, not the whole URL, to check it ends in /v1/systemone', () => {
    const form = formOf({ ...custom, endpoint: 'https://h/v1/systemone/extra', name: 'm' });
    expect(Object.keys(problemsOf(form))).toEqual(['endpoint']);
  });

  it('rejects a non-http endpoint', () => {
    const form = formOf({ ...custom, endpoint: 'ftp://h/v1/systemone', name: 'm' });
    expect(Object.keys(problemsOf(form))).toEqual(['endpoint']);
  });

  it('asks for a name, and for a whole number of options of 2 or more', () => {
    const form = formOf({
      ...custom,
      endpoint: 'https://h/v1/systemone',
      name: '',
      maxOptions: '1',
    });
    expect(problemsOf(form)).toEqual({
      name: 'Enter the model name',
      maxOptions: 'A whole number of 2 or more, or blank for the default',
    });
  });
});

describe('forgetSent', () => {
  it('drops the key once the form is sent, and keeps the rest', () => {
    const sent = forgetSent({
      ...chooseProvider('typesafe'),
      apiKey: 'tk-secret',
      name: 'jev-preview',
    });
    expect(sent).toMatchObject({
      apiKey: '',
      name: 'jev-preview',
      provider: 'typesafe',
    });
  });
});

describe('Cloudflare account IDs', () => {
  const UPPER = '0123456789ABCDEF0123456789ABCDEF';
  const LOWER = UPPER.toLowerCase();

  it('reopens an uppercase Cloudflare endpoint as Cloudflare, with the ID lowercased', () => {
    const saved: ModelInfo = {
      name: 'clef',
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${UPPER}/ai/run/@cf/cloudflare/clef`,
      maxOptions: 255,
    };
    expect(formFor(saved)).toMatchObject({ provider: 'cloudflare', accountId: LOWER });
  });

  it('resubmits a reopened uppercase account without rejecting it', () => {
    const saved: ModelInfo = {
      name: 'clef',
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${UPPER}/ai/run/@cf/cloudflare/clef`,
      maxOptions: 255,
    };
    expect(readAction({ ...formFor(saved), apiKey: 'cf-token' })).toMatchObject({
      ok: true,
      action: {
        type: 'setModel',
        model: { endpoint: expect.stringContaining(`/accounts/${LOWER}/`) },
      },
    });
  });

  it('sends the account lowercased even when the form still holds an uppercase one', () => {
    const form = { ...chooseProvider('cloudflare'), accountId: UPPER, apiKey: 'cf-token' };
    expect(readAction(form)).toMatchObject({
      ok: true,
      action: {
        type: 'setModel',
        model: { endpoint: expect.stringContaining(`/accounts/${LOWER}/`) },
      },
    });
  });
});
