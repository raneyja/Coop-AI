"use client";

import { FormEvent, useState } from "react";

type ContactFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  /** Prefill demo message (e.g. from hero example ?prompt=) */
  defaultMessage?: string;
};

export function ContactForm({
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
          type: "demo",
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
      <div className="coop-panel p-8 text-center">
        <p className="text-lg font-medium text-gray-900">Thanks — we&apos;ll be in touch soon.</p>
        <p className="mt-2 text-sm text-coop-muted">Our team will reach out to schedule your demo.</p>
      </div>
    );
  }

  return (
    <div className="coop-panel p-8">
      <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
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
        <div>
          <label htmlFor="message" className="block text-sm font-medium text-gray-900">
            What would you like to explore?
          </label>
          <textarea
            id="message"
            name="message"
            rows={3}
            defaultValue={defaultMessage}
            key={defaultMessage ?? "message-empty"}
            className="mt-1.5 w-full rounded-sm border border-coop-border bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-coop-muted/60 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300"
            placeholder="Team size, repos, security requirements..."
          />
        </div>

        {status === "error" && (
          <p className="text-sm text-red-600" role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded bg-black py-2.5 text-sm font-medium text-white transition hover:bg-gray-900 disabled:opacity-60 sm:w-auto sm:px-8"
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
      <label htmlFor={name} className="block text-sm font-medium text-gray-900">
        {label}
        {required && <span className="text-coop-muted"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-sm border border-coop-border bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-coop-muted/60 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300"
      />
    </div>
  );
}
