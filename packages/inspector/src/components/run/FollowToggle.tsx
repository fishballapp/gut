import { Toggle } from '@base-ui/react/toggle';
import { useEffect, useEffectEvent } from 'react';
import { isShortcutBlockedTarget } from '../../lib/shortcut-target.ts';
import { Keycap } from './Keycap.tsx';

/** Follow (L): pressed while the newest turn stays selected; pressing it again jumps back to the newest. */
export const FollowToggle = ({
  isFollowing,
  onFollow,
}: {
  isFollowing: boolean;
  onFollow: () => void;
}) => {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'l' && event.key !== 'L') return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.repeat || isShortcutBlockedTarget(event.target)) return;
    event.preventDefault();
    onFollow();
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <Toggle
      pressed={isFollowing}
      onPressedChange={onFollow}
      className="inline-flex h-7 items-center rounded-md border border-line bg-raised px-2.5 text-[12px] font-medium text-ink hover:border-ink/40 data-[pressed]:border-ink data-[pressed]:bg-ink data-[pressed]:text-ground"
    >
      {isFollowing ? 'Following' : 'Follow'}
      <Keycap>L</Keycap>
    </Toggle>
  );
};
