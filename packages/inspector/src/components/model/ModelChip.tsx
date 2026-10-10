import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { Tooltip } from '@base-ui/react/tooltip';
import type { Action, ModelInfo } from '@gut.run/core/inspector';
import { useRef, useState } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import { ModelPicker } from './ModelPicker.tsx';

/** The model by name, and the host that serves it. */
const describeModel = (model: ModelInfo) => `${model.name} · ${new URL(model.endpoint).host}`;

const chipClass =
  'flex min-w-0 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-raised px-2.5 py-0.5 text-[13px]';

/** The model's name, cut with an ellipsis when the bar is narrow; the full text is on hover. */
const ChipLabel = ({ text }: { text: string }) => (
  <span className="min-w-0 truncate" title={text}>
    {text}
  </span>
);

const ModelDot = ({ isSet }: { isSet: boolean }) => (
  <span
    aria-hidden
    className={
      isSet
        ? 'size-[7px] rounded-full bg-ok'
        : 'size-[7px] rounded-full border-[1.5px] border-muted'
    }
  />
);

/** A run's own model: from its config, so shown and never changed here. Disabled, but focusable for its tooltip. */
const TaskModel = ({ model }: { model: ModelInfo }) => (
  <Tooltip.Root>
    <Tooltip.Trigger
      render={<Button disabled focusableWhenDisabled className={`${chipClass} cursor-default`} />}
    >
      <ModelDot isSet />
      <ChipLabel text={describeModel(model)} />
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Positioner sideOffset={6}>
        <Tooltip.Popup className="rounded-md border border-line bg-raised px-2 py-1 text-[12px] text-ink shadow-sm">
          From the task's gut config, so it can't be changed here
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>
);

/** The model set in this page, for runs without their own: the pill opens the picker to show or change it. */
const PageModel = ({
  model,
  act,
}: {
  model: ModelInfo | null;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  // Closing by Esc or × returns focus to the pill. Closing because a model was set or cleared
  // leaves it on the page, so the next Space plays rather than pressing the pill again.
  const isDone = useRef(false);
  const open = (nextIsOpen: boolean) => {
    if (nextIsOpen) isDone.current = false;
    setIsOpen(nextIsOpen);
  };
  return (
    <Dialog.Root open={isOpen} onOpenChange={open}>
      <Dialog.Trigger className={`${chipClass} hover:border-ink/40`}>
        <ModelDot isSet={model !== null} />
        <ChipLabel text={model === null ? 'No model' : describeModel(model)} />
      </Dialog.Trigger>
      <ModelPicker
        model={model}
        act={act}
        onDone={() => {
          isDone.current = true;
          setIsOpen(false);
        }}
        returnsFocus={() => !isDone.current}
      />
    </Dialog.Root>
  );
};

/** The model the selected run uses, or the page's for runs without one, or none. */
export const ModelChip = ({
  runModel,
  pageModel,
  act,
}: {
  runModel: ModelInfo | null;
  pageModel: ModelInfo | null;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  if (runModel !== null) return <TaskModel model={runModel} />;
  return <PageModel model={pageModel} act={act} />;
};
