import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from '@base-ui/react/button';
import { actionClass } from './run/RunControls.tsx';

/** Asks before an action that drops answers: what it does, what is lost, and the action itself. */
export const ConfirmDialog = ({
  isOpen,
  onOpenChange,
  title,
  description,
  cancel,
  confirm,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  description: string;
  cancel: string;
  confirm: string;
  onConfirm: () => void;
}) => (
  <AlertDialog.Root open={isOpen} onOpenChange={onOpenChange}>
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className="fixed inset-0 bg-ground/40" />
      <AlertDialog.Popup className="fixed top-1/2 left-1/2 flex w-[min(400px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-line bg-raised p-6 shadow-lg">
        <div className="flex flex-col gap-1">
          <AlertDialog.Title className="text-[16px] font-semibold text-ink">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[13px] text-muted">
            {description}
          </AlertDialog.Description>
        </div>
        <div className="flex justify-end gap-2">
          <AlertDialog.Close className={actionClass(false)}>{cancel}</AlertDialog.Close>
          <Button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
            className={actionClass(true)}
          >
            {confirm}
          </Button>
        </div>
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);
