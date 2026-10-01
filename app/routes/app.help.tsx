import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  HelpContactError,
  getHelpPageLinks,
  sendHelpContactEmail,
} from "../models/help-support.server";
import { authenticate } from "../shopify.server";

const MODAL_ID = "help-support-contact-modal";
const FORM_ID = "help-support-contact-form";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ContactForm = {
  name: string;
  phone: string;
  email: string;
  subject: string;
  message: string;
};

type FormErrors = Partial<Record<keyof ContactForm, string>>;

const EMPTY_FORM: ContactForm = {
  name: "",
  phone: "",
  email: "",
  subject: "",
  message: "",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return getHelpPageLinks();
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  try {
    await sendHelpContactEmail({
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      subject: String(formData.get("subject") ?? ""),
      message: String(formData.get("message") ?? ""),
      shopDomain: session.shop,
    });
    return data({ success: true as const });
  } catch (error) {
    if (error instanceof HelpContactError) {
      return data(
        { success: false as const, error: error.message },
        { status: error.status },
      );
    }
    return data(
      {
        success: false as const,
        error: "Failed to send message. Please try again.",
      },
      { status: 500 },
    );
  }
};

export default function HelpSupportPage() {
  const { helpCenterUrl, scheduleUrl, supportEmail, appName } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [banner, setBanner] = useState("");
  const sending =
    fetcher.state === "submitting" || fetcher.state === "loading";
  const awaitingResult = useRef(false);
  const dataAtSubmit = useRef(fetcher.data);

  const closeModal = () => setModalOpen(false);

  const resetContactForm = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setBanner("");
  };

  const openModal = () => {
    resetContactForm();
    setModalOpen(true);
  };

  useEffect(() => {
    const modal = findHelpModal();
    if (!modal) return;
    if (modalOpen) modal.showOverlay();
    else modal.hideOverlay();
  }, [modalOpen]);

  useEffect(() => {
    if (!awaitingResult.current || fetcher.state !== "idle") return;
    awaitingResult.current = false;

    // Network / no response: alerts allow error toast for connection failures.
    if (!fetcher.data || fetcher.data === dataAtSubmit.current) {
      shopify.toast.show("Couldn't send", { isError: true });
      setBanner("Check your connection and try again.");
      return;
    }

    // Success: toast only (≤3 words), then close modal — no success panel/banner.
    if (fetcher.data.success) {
      resetContactForm();
      shopify.toast.show("Message sent");
      setModalOpen(false);
      return;
    }

    // Task/send failure: critical banner near top of modal; no error toast.
    setBanner(
      fetcher.data.error || "Failed to send message. Please try again.",
    );
  }, [fetcher.data, fetcher.state, shopify]);

  const patch = (field: keyof ContactForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const validate = () => {
    const next: FormErrors = {};
    const name = form.name.trim();
    const email = form.email.trim();
    const subject = form.subject.trim();
    const message = form.message.trim();

    if (!name) next.name = "Full name is required.";
    if (!email) next.email = "Email address is required.";
    else if (!EMAIL_REGEX.test(email)) {
      next.email = "Please enter a valid email address.";
    }
    if (!subject) next.subject = "Subject is required.";
    if (!message) next.message = "Message is required.";

    setErrors(next);
    setBanner("");
    return Object.keys(next).length === 0;
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate() || sending) return;
    dataAtSubmit.current = fetcher.data;
    awaitingResult.current = true;
    fetcher.submit(
      {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
      },
      { method: "post" },
    );
  };

  return (
    <s-page heading="Help & Support">
      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
        gap="base"
      >
        <s-section heading="Need help with setup?">
          <s-unordered-list>
            <s-list-item>
              <s-link href={helpCenterUrl} target="_blank">
                View user guide
              </s-link>
            </s-list-item>
            <s-list-item>
              <s-link href={scheduleUrl} target="_blank">
                Schedule a Zoom Meeting for free setup assistance
              </s-link>
            </s-list-item>
          </s-unordered-list>
        </s-section>

        <s-section heading="Got Support?">
          <s-button
            variant="secondary"
            commandFor={MODAL_ID}
            command="--show"
            onClick={openModal}
          >
            Send a message to the developer
          </s-button>
        </s-section>
      </s-grid>

      <s-modal id={MODAL_ID} heading="Contact Us" onHide={closeModal}>
        <form id={FORM_ID} onSubmit={onSubmit}>
          <s-stack gap="base">
            {banner ? (
              <s-banner tone="critical" heading="Couldn't send">
                {banner}
              </s-banner>
            ) : null}
            <s-text-field
              label="Full Name"
              name="name"
              value={form.name}
              placeholder="Jane Smith"
              autocomplete="name"
              error={errors.name}
              onInput={(event: Event) => patch("name", fieldValue(event))}
            />
            <s-text-field
              label="Phone Number (optional)"
              name="phone"
              value={form.phone}
              placeholder="+1 (555) 000-0000"
              onInput={(event: Event) => patch("phone", fieldValue(event))}
            />
            <s-email-field
              label="Email Address"
              name="email"
              value={form.email}
              placeholder="jane@yourstore.com"
              autocomplete="email"
              error={errors.email}
              onInput={(event: Event) => patch("email", fieldValue(event))}
            />
            <s-text-field
              label="Subject"
              name="subject"
              value={form.subject}
              placeholder="How can we help?"
              error={errors.subject}
              onInput={(event: Event) => patch("subject", fieldValue(event))}
            />
            <s-text-area
              label="Message"
              name="message"
              value={form.message}
              placeholder="Describe your issue or question in detail..."
              rows={5}
              error={errors.message}
              onInput={(event: Event) => patch("message", fieldValue(event))}
            />
            <s-paragraph>
              Replies go to your email. You can also reach us at{" "}
              <s-link href={`mailto:${supportEmail}`}>{supportEmail}</s-link>.
              Messages are sent to the {appName} team. We usually reply within
              one business day.
            </s-paragraph>
          </s-stack>
        </form>

        <s-button
          slot="secondary-actions"
          variant="secondary"
          type="button"
          commandFor={MODAL_ID}
          command="--hide"
          onClick={closeModal}
          {...(sending ? { disabled: true } : {})}
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          type="button"
          onClick={() => {
            const formEl = document.getElementById(FORM_ID);
            if (formEl instanceof HTMLFormElement) formEl.requestSubmit();
          }}
          {...(sending ? { loading: true, disabled: true } : {})}
        >
          {sending ? "Sending..." : "Send Message"}
        </s-button>
      </s-modal>
    </s-page>
  );
}

type HelpField =
  | HTMLElementTagNameMap["s-text-field"]
  | HTMLElementTagNameMap["s-email-field"]
  | HTMLElementTagNameMap["s-text-area"];

function isHelpField(target: EventTarget | null): target is HelpField {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "S-TEXT-FIELD" ||
      target.tagName === "S-EMAIL-FIELD" ||
      target.tagName === "S-TEXT-AREA")
  );
}

function fieldValue(event: Event) {
  if (!isHelpField(event.currentTarget)) return "";
  return event.currentTarget.value;
}

function isHelpModal(
  element: Element | null,
): element is HTMLElementTagNameMap["s-modal"] {
  return element instanceof HTMLElement && element.tagName === "S-MODAL";
}

function findHelpModal() {
  const modal = document.getElementById(MODAL_ID);
  return isHelpModal(modal) ? modal : null;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
