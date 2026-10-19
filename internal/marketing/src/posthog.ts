import { type Consent, getConsent, onConsentChange } from '@fishballapps/cookie-consent';

declare global {
  interface Window {
    /** The PostHog snippet's stub until the SDK loads, then the SDK; both queue these calls. */
    posthog?: {
      capture?: (event: string, properties?: Record<string, unknown>) => void;
      opt_in_capturing?: (options?: { captureEventName?: string | null | false }) => void;
      opt_out_capturing?: () => void;
    };
  }
}

/**
 * Capture a marketing conversion only after the visitor has made a consent choice. The snippet's
 * stub queues `capture()` until the SDK loads, and on Accept the SDK replays that queue after the
 * opt-in, so a click made while `getConsent()` is still `null` must never reach `posthog.capture`:
 * a pre-choice CTA would ship after Accept. Once a choice exists, capture as usual; a rejecter is
 * still counted on PostHog's cookieless path. Returns whether it captured, so a once-per-page event
 * can wait for the first one after the choice.
 */
export const captureIfDecided = (event: string, properties?: Record<string, unknown>): boolean => {
  if (getConsent() === null) return false;
  window.posthog?.capture?.(event, properties);
  return true;
};

const applyConsent = (consent: Consent, isUserAction: boolean): void => {
  if (consent === 'denied') {
    window.posthog?.opt_out_capturing?.();
    return;
  }
  // Re-applying a stored choice on page load must not record another `$opt_in` event.
  window.posthog?.opt_in_capturing?.(isUserAction ? undefined : { captureEventName: false });
};

/** Makes PostHog follow the `@fishballapps/cookie-consent` store: the stored choice now, each
 * change later. */
export const syncPostHogWithConsent = (): void => {
  const stored = getConsent();
  if (stored !== null) applyConsent(stored, false);
  onConsentChange(consent => applyConsent(consent, true));
};
