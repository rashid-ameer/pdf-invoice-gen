const RESEND_DOMAINS_URL = "https://resend.com/domains";

/** Same sandbox banner used on the Email hub and Sender and recipients. */
export function EmailSandboxBanner({ emailFrom }: { emailFrom: string }) {
  const isSandbox = Boolean(emailFrom && /@resend\.dev$/i.test(emailFrom));
  if (!isSandbox) return null;

  return (
    <s-banner
      slot="supplemental-start"
      tone="warning"
      heading="Sandbox mode"
    >
      Emails are only delivered to your email provider account email until you
      verify your own domain.
      <s-button
        slot="secondary-actions"
        variant="secondary"
        href={RESEND_DOMAINS_URL}
        target="_blank"
      >
        Verify domain
      </s-button>
    </s-banner>
  );
}
