/** A keyboard shortcut shown inside a control, as in the Marked sketches. */
export const Keycap = ({ children }: { children: string }) => (
  <kbd className="ml-1.5 inline-grid h-[18px] min-w-[18px] place-items-center rounded-[3px] border border-current/25 px-1 font-mono text-[11px] font-medium leading-none opacity-70">
    {children}
  </kbd>
);
