// Records a gut inspector run by streaming GET /api/events and writing JSONL. It reads gut's own
// stream, which sends one `data:` line of JSON per event, separated by LF.
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { InspectorEventSchema } from '@gut.run/core/inspector';
import { z } from 'zod';

const parseCliArgs = () => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      play: { type: 'boolean' },
      'max-seconds': { type: 'string' },
    },
    allowPositionals: true,
  });

  const isPlay = values.play ?? false;
  let maxSeconds: number | undefined;
  if (values['max-seconds'] !== undefined) {
    const parsed = Number(values['max-seconds']);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`invalid --max-seconds: ${values['max-seconds']}`);
    }
    maxSeconds = parsed;
  }

  const [urlArg, outPathArg] = positionals;
  if (urlArg === undefined || outPathArg === undefined) {
    throw new Error(
      'Usage: node projects/gut/packages/inspector/scripts/record.ts <inspector URL with ?token=> <out.jsonl> [--play] [--max-seconds <n>]',
    );
  }

  return { url: urlArg, outPath: outPathArg, isPlay, maxSeconds };
};

const isStreamTermination = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return true;
  if (error instanceof TypeError && error.message === 'terminated') return true;
  return false;
};

const record = async () => {
  const { url: urlArg, outPath, isPlay, maxSeconds } = parseCliArgs();

  const inspectorUrl = new URL(urlArg);
  const token = inspectorUrl.searchParams.get('token');
  if (token === null || token === '') {
    throw new Error('the inspector URL must include ?token=...');
  }

  const eventsUrl = new URL('/api/events', inspectorUrl);
  eventsUrl.searchParams.set('token', token);
  const actionsUrl = new URL('/api/actions', inspectorUrl);

  const abortController = new AbortController();
  const timeoutHandle =
    maxSeconds === undefined
      ? undefined
      : setTimeout(() => {
          abortController.abort();
        }, maxSeconds * 1000);

  let fileHandle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    const response = await fetch(eventsUrl, {
      signal: abortController.signal,
      headers: { accept: 'text/event-stream' },
    });
    if (!response.ok) {
      throw new Error(`failed to connect: ${response.status} ${response.statusText}`);
    }
    if (response.body === null) {
      throw new Error('no response body');
    }

    await mkdir(dirname(outPath), { recursive: true });
    fileHandle = await open(outPath, 'w');

    if (isPlay) {
      const playResponse = await fetch(actionsUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gut-token': token,
        },
        body: JSON.stringify({ type: 'play' }),
        signal: abortController.signal,
      });
      if (!playResponse.ok) {
        throw new Error(
          `failed to send play action: ${playResponse.status} ${playResponse.statusText}`,
        );
      }
    }

    const reader = response.body.getReader();
    const onAbort = () => {
      void reader.cancel().catch(() => {});
    };
    abortController.signal.addEventListener('abort', onAbort, { once: true });

    const decoder = new TextDecoder();
    let buffer = '';
    let isEnded = false;

    try {
      while (!isEnded) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex !== -1) {
          const block = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);

          for (const line of block.split(/\r?\n/)) {
            if (!line.startsWith('data: ')) continue;
            const dataText = line.slice(6);
            let rawJson: unknown;
            try {
              rawJson = JSON.parse(dataText);
            } catch {
              throw new Error(`failed to parse event JSON: ${dataText}`);
            }

            const parsed = InspectorEventSchema.safeParse(rawJson);
            if (!parsed.success) {
              throw new Error(
                `event did not match InspectorEventSchema: ${z.prettifyError(parsed.error)}: ${dataText}`,
              );
            }

            await fileHandle.write(`${JSON.stringify(parsed.data)}\n`);
            if (parsed.data.type === 'session.ended') {
              isEnded = true;
              break;
            }
          }

          if (isEnded) break;
          boundaryIndex = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (!abortController.signal.aborted && !isStreamTermination(error)) {
        throw error;
      }
    } finally {
      abortController.signal.removeEventListener('abort', onAbort);
      try {
        await reader.cancel();
      } catch {
        // Ignored: stream may already be closed.
      }
    }

    if (abortController.signal.aborted) {
      process.stderr.write(`Stopped after ${maxSeconds} seconds.\n`);
    } else if (!isEnded) {
      process.stderr.write('the stream ended before session.ended; the recording is partial\n');
      process.exitCode = 1;
    }
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (fileHandle !== undefined) await fileHandle.close();
  }
};

await record();
