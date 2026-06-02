"use client";

import { FormEvent, useState } from "react";

type FormType = "demo" | "waitlist";

type ContactFormProps = {
  type: FormType;
  title: string;
  description: string;
  submitLabel: string;
  /** Prefill demo message (e.g. from hero example ?prompt=) */
  defaultMessage?: string;
};

export function ContactForm({
  type,
  title,
  description,
  submitLabel,
  defaultMessage
}: ContactFormProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          email: data.get("email"),
          name: data.get("name"),
          company: data.get("company"),
          role: data.get("role"),
          message: data.get("message")
        })
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Something went wrong.");
      }

      setStatus("success");
      form.reset();
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-white/10 bg-coop-surface/50 p-8 text-center">
        <p className="text-lg font-medium text-white">Thanks — we&apos;ll be in touch soon.</p>
        <p className="mt-2 text-sm text-coop-muted">
          {type === "demo"
            ? "Our team will reach out to schedule your demo."
            : "You're on the waitlist. We'll notify you when the extension is available."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-coop-surface/50 p-8">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm text-coop-muted">{description}</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" name="name" required />
          <Field label="Work email" name="email" type="email" required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" name="company" />
          <Field label="Role" name="role" placeholder="e.g. Staff Engineer" />
        </div>
        {type === "demo" && (
          <div>
            <label htmlFor="message" className="block text-sm font-medium text-white/90">
              What would you like to explore?
            </label>
            <textarea
              id="message"
              name="message"
              rows={3}
              defaultValue={defaultMessage}
              key={defaultMessage ?? "message-empty"}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-coop-dark px-3 py-2 text-sm text-white placeholder:text-coop-muted/60 focus:border-coop-blue focus:outline-none focus:ring-1 focus:ring-coop-blue"
              placeholder="Team size, repos, security requirements..."
            />
          </div>
        )}

        {status === "error" && (
          <p className="text-sm text-red-400" role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded-full bg-white py-2.5 text-sm font-medium text-coop-dark transition hover:bg-white/90 disabled:opacity-60 sm:w-auto sm:px-8"
        >
          {status === "loading" ? "Submitting…" : submitLabel}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-white/90">
        {label}
        {required && <span className="text-coop-muted"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-coop-dark px-3 py-2 text-sm text-white placeholder:text-coop-muted/60 focus:border-coop-blue focus:outline-none focus:ring-1 focus:ring-coop-blue"
      />
    </div>
  );
}
