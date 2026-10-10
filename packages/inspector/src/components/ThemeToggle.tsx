import { Toggle } from '@base-ui/react/toggle';
import { MoonIcon, SunIcon } from '@phosphor-icons/react';
import { useState } from 'react';

type Theme = 'light' | 'dark';

const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

/** Light or dark, remembered; index.html applies it before first paint. */
export const ThemeToggle = () => {
  const [theme, setTheme] = useState(currentTheme);
  const isDark = theme === 'dark';
  return (
    <Toggle
      aria-label="Dark theme"
      pressed={isDark}
      onPressedChange={pressed => {
        const next: Theme = pressed ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('gut:theme', next);
        setTheme(next);
      }}
      className="grid size-7 place-items-center rounded-md border border-line text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
    >
      {isDark ? <MoonIcon size={15} /> : <SunIcon size={15} />}
    </Toggle>
  );
};
