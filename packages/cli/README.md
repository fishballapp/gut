# @gut.run/cli

The `gut` bin: `gut run task.gut.ts` runs a task written with
[`@gut.run/core`](https://www.npmjs.com/package/@gut.run/core).

See the [gut README](https://github.com/fishballapp/gut#readme) for tasks, ops and configuration.

## Usage

```sh
gut run task.gut.ts [args…]
gut run task.gut.ts --inspect [--port <n>] [--no-open] [-- args…]
```

The task reads its args as `process.argv.slice(2)`, as under `node <file>`. Put `--` before any arg
that starts with `-`.

## Flags

| Flag | Default | What it does |
| --- | --- | --- |
| `--inspect` | off | Serve the inspector and run the task in a child process (below) |
| `--port <n>` | a free port | The inspector's port |
| `--open` / `--no-open` | `--open` | Open the page in the browser when stdout is a terminal; `--no-open` never does. The URL is printed to stderr either way |

`--inspect` serves the page's built assets (`@gut.run/inspector`). From a source checkout, build
them first with `pnpm -F @gut.run/inspector build`; without the build, the command stops with that
message.

## The inspector

`--inspect` prints the page's URL, which carries a token for this process. Each run of the task is a
child process forked from the same CLI, so a restart loads the task's code afresh. The CLI keeps the
run's record until you restart or stop it.

Page keys do not fire while focus is on a button, a link, a text field or another control, or inside a
dialog. Two exceptions: the rounds keep their own arrows while focus is in them, and while you choose,
an option's radio keeps the letter, digit and ↵ keys.

| Key | What it does |
| --- | --- |
| Space | Play, or Pause: the model answers every turn until you pause |
| S | Step: asks the model the waiting turn, keeps the answer it gave, or runs the picked step |
| T | Restart: stops the task and runs it again in a fresh child process; the record starts afresh |
| E | Edit the op tree the waiting pick reads (descriptions, labels, hidden moves) in a dialog; the context's Edit opens the context. Save (⌘↵) re-picks the round with the edits, asking first when it has answers to drop |
| R | Pick again: drops the model's answer to the waiting turn, so you answer it or ask again. An earlier turn of the waiting round has its own Pick again, which asks first and clears the turns after it |
| ↵ | Confirm the model's answer to the waiting turn, or answer it with your choices once every question has one; run the picked step |
| G / N | While you choose: "achieved" or "not yet" on the goal question |
| 1 to 9 | While you choose: one of the first nine options a question shows |
| / | Focus the filter of a long question, while you choose on a waiting turn. The filter field shows on every long question, answered or not |
| L | Follow the live run again, after selecting a round or turn |
| ↑ / ↓ | Previous or next round |
| ← / → | Previous or next turn, across rounds |

The options slider in the run header sets how many options a question offers. Its own keys (← / →,
Home / End, Page Up / Page Down) move it, and a move re-picks the waiting question when you let go.

Ctrl-C (or SIGTERM) stops the task, then the server, and exits: 130 for Ctrl-C, 143 for SIGTERM. The
task gets SIGTERM and, if it is still running after a second, SIGKILL.
