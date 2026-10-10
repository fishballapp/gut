import type { ModelInfo } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import { chooseChoice, formFor, type ModelForm, readModel } from './model-form.ts';

const formOf = (overrides: Partial<ModelForm>): ModelForm => ({
  choice: 'custom',
  endpoint: '',
  name: '',
  maxOptions: '',
  apiKey: '',
  ...overrides,
});

const CLEF: ModelInfo = {
  name: 'clef-flash',
  endpoint: 'http://localhost:11434/v1/systemone',
  maxOptions: 26,
};

describe('formFor', () => {
  it('opens on Jev when the page has no model', () => {
    expect(formFor(null)).toMatchObject({ choice: 'jev', endpoint: '', name: '', maxOptions: '' });
  });

  it('picks the named choice a page model matches', () => {
    expect(formFor(CLEF)).toMatchObject({ choice: 'clef', name: 'clef-flash', maxOptions: '26' });
  });

  it('keeps a custom Clef with its own option limit as custom', () => {
    const smaller: ModelInfo = { ...CLEF, maxOptions: 9 };
    expect(formFor(smaller)).toMatchObject({ choice: 'custom', maxOptions: '9' });
  });

  it('opens a model that matches no named choice as custom, filled in', () => {
    const other: ModelInfo = { name: 'x', endpoint: 'http://h:1/v1/systemone', maxOptions: 9 };
    expect(formFor(other)).toMatchObject({
      choice: 'custom',
      endpoint: 'http://h:1/v1/systemone',
      name: 'x',
      maxOptions: '9',
    });
  });
});

describe('chooseChoice', () => {
  it('clears the key when the choice changes, so it never reaches another provider', () => {
    const typed = formOf({ choice: 'jev', apiKey: 'sk-or-secret' });
    expect(chooseChoice(typed, 'custom')).toEqual({ ...typed, choice: 'custom', apiKey: '' });
  });

  it('keeps the rest of the form', () => {
    const typed = formOf({ choice: 'custom', endpoint: 'http://h/v1/systemone', name: 'm' });
    expect(chooseChoice(typed, 'clef')).toMatchObject({
      endpoint: 'http://h/v1/systemone',
      name: 'm',
    });
  });
});

describe('readModel', () => {
  it('sends Jev with its key and the fixed endpoint, name and size', () => {
    expect(readModel(formOf({ choice: 'jev', apiKey: ' sk-or-1 ' }))).toEqual({
      ok: true,
      model: {
        endpoint: 'https://openrouter.ai/api/v1/systemone',
        name: '~typesafe/jev-latest',
        maxOptions: 255,
        apiKey: 'sk-or-1',
      },
    });
  });

  it('needs a key for Jev', () => {
    expect(readModel(formOf({ choice: 'jev', apiKey: '   ' }))).toEqual({
      ok: false,
      problems: { apiKey: 'Enter the API key' },
    });
  });

  it('sends Clef with no key, even one typed for another choice', () => {
    expect(readModel(formOf({ choice: 'clef', apiKey: 'sk-left-over' }))).toEqual({
      ok: true,
      model: {
        endpoint: 'http://localhost:11434/v1/systemone',
        name: 'clef-flash',
        maxOptions: 26,
      },
    });
  });

  it('sends a custom endpoint trimmed, leaving out a blank key and a blank size', () => {
    expect(
      readModel(
        formOf({ endpoint: ' http://localhost:11434/v1/systemone ', name: ' clef ', apiKey: ' ' }),
      ),
    ).toEqual({
      ok: true,
      model: { endpoint: 'http://localhost:11434/v1/systemone', name: 'clef' },
    });
  });

  it('sends a custom key and size when given', () => {
    expect(
      readModel(
        formOf({
          endpoint: 'https://example.com/v1/systemone',
          name: 'm',
          maxOptions: '40',
          apiKey: 'k',
        }),
      ),
    ).toEqual({
      ok: true,
      model: {
        endpoint: 'https://example.com/v1/systemone',
        name: 'm',
        maxOptions: 40,
        apiKey: 'k',
      },
    });
  });

  it('rejects an endpoint that does not end in /v1/systemone', () => {
    const result = readModel(formOf({ endpoint: 'http://localhost:11434/v1', name: 'm' }));
    expect(result).toMatchObject({ ok: false, problems: { endpoint: expect.any(String) } });
  });

  it('rejects an endpoint that is not an http(s) URL', () => {
    expect(readModel(formOf({ endpoint: 'ftp://x/v1/systemone', name: 'm' }))).toMatchObject({
      ok: false,
      problems: { endpoint: expect.any(String) },
    });
    expect(readModel(formOf({ endpoint: 'not a url/v1/systemone', name: 'm' }))).toMatchObject({
      ok: false,
      problems: { endpoint: expect.any(String) },
    });
  });

  it('accepts a query string on the endpoint, as the CLI does', () => {
    expect(
      readModel(formOf({ endpoint: 'http://h:1/v1/systemone?tenant=x', name: 'm' })),
    ).toMatchObject({ ok: true, model: { endpoint: 'http://h:1/v1/systemone?tenant=x' } });
  });

  it('checks the path, not the rest of the string', () => {
    expect(
      readModel(formOf({ endpoint: 'http://h/wrong?x=/v1/systemone', name: 'm' })),
    ).toMatchObject({ ok: false, problems: { endpoint: expect.any(String) } });
    expect(
      readModel(formOf({ endpoint: 'http://h/wrong#/v1/systemone', name: 'm' })),
    ).toMatchObject({
      ok: false,
      problems: { endpoint: expect.any(String) },
    });
  });

  it('rejects a trailing slash after /v1/systemone', () => {
    expect(
      readModel(formOf({ endpoint: 'http://localhost:11434/v1/systemone/', name: 'm' })),
    ).toMatchObject({ ok: false, problems: { endpoint: expect.any(String) } });
  });

  it('needs a model name for a custom endpoint', () => {
    expect(
      readModel(formOf({ endpoint: 'http://localhost:11434/v1/systemone', name: '  ' })),
    ).toMatchObject({ ok: false, problems: { name: expect.any(String) } });
  });

  it('takes a size of 2 or more, and nothing else', () => {
    const endpoint = 'http://localhost:11434/v1/systemone';
    expect(readModel(formOf({ endpoint, name: 'm', maxOptions: '1' }))).toMatchObject({
      ok: false,
      problems: { maxOptions: expect.any(String) },
    });
    expect(readModel(formOf({ endpoint, name: 'm', maxOptions: '2.5' }))).toMatchObject({
      ok: false,
      problems: { maxOptions: expect.any(String) },
    });
    expect(readModel(formOf({ endpoint, name: 'm', maxOptions: '2' }))).toMatchObject({
      ok: true,
      model: { maxOptions: 2 },
    });
  });

  it('reports every problem with a custom form at once', () => {
    const result = readModel(formOf({ endpoint: 'nope', name: '', maxOptions: 'x' }));
    expect(result).toMatchObject({
      ok: false,
      problems: {
        endpoint: expect.any(String),
        name: expect.any(String),
        maxOptions: expect.any(String),
      },
    });
  });
});
