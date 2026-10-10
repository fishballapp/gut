import type { OpAddress } from '@gut.run/core/inspector';

/**
 * Whether a node sits on the path to the picked step: its address is a prefix of the pick's.
 * A choice is on the path only when its index matches the pick's.
 */
export const isOnPath = (nodeAddress: OpAddress, pickedAddress: OpAddress): boolean => {
  if (nodeAddress.keys.length > pickedAddress.keys.length) return false;
  if (!nodeAddress.keys.every((key, i) => key === pickedAddress.keys[i])) return false;
  if (nodeAddress.choice === undefined) return true;
  return (
    nodeAddress.keys.length === pickedAddress.keys.length &&
    nodeAddress.choice === pickedAddress.choice
  );
};
