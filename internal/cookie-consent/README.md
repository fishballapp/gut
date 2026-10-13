# @fishballapps/cookie-consent

Framework-free TypeScript cookie consent store and custom element for Astro marketing sites and React SPAs. Zero runtime dependencies. Complies with UK PECR and ICO guidance (equal weight Accept/Reject buttons, non-blocking bar, no tracking prior to consent, persisted choice in `localStorage`).

The package root (`@fishballapps/cookie-consent`) exports only the store (`getConsent`, `setConsent`, `onConsentChange`, …). Import the custom element from `@fishballapps/cookie-consent/element` so a server-side `getConsent` import never evaluates `class … extends HTMLElement`.

## Custom Element Usage

### Astro

Register the element and render `<cookie-consent>`:

```astro
<cookie-consent policy-href="/privacy"></cookie-consent>

<script>
  import '@fishballapps/cookie-consent/element';
</script>
```

### React (React 19+)

React 19 natively supports custom elements and attributes:

```tsx
import '@fishballapps/cookie-consent/element';

export function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <cookie-consent policy-href="/privacy" />
    </>
  );
}
```

### Reopening via "Cookie settings"

Any element with a `data-cookie-settings` attribute anywhere in the DOM will reopen the banner via a delegated click listener:

```html
<button type="button" data-cookie-settings>Cookie settings</button>
```

## Analytics Hook (e.g. PostHog)

Analytics libraries sync with the consent store using `getConsent` and `onConsentChange`:

```ts
import { getConsent, onConsentChange } from '@fishballapps/cookie-consent';

const applyConsent = (consent: 'granted' | 'denied' | null) => {
  if (consent === 'granted') {
    posthog.opt_in_capturing();
  } else if (consent === 'denied') {
    posthog.opt_out_capturing();
  }
};

// Initial state on page load
applyConsent(getConsent());

// Listen for updates when user clicks Accept/Reject
onConsentChange((consent) => {
  applyConsent(consent);
});
```
