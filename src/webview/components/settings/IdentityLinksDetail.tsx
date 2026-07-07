import React, { useMemo } from "react";
import { identityDirectorySummary, personFormFromRecord } from "../../../identity/identityDirectory";
import type { IdentityDirectory, PersonIdentityForm } from "../../../identity/types";
import { SettingsSection } from "./SettingsShared";

type IdentityLinksDetailProps = {
  directory: IdentityDirectory;
  signedIn: boolean;
};

function emptySelfForm(): PersonIdentityForm {
  return {
    id: "person-self",
    displayName: "",
    githubLogin: "",
    gitlabLogin: "",
    slackHandle: "",
    slackUserId: "",
    workEmail: "",
    personalEmail: "",
    jiraEmail: "",
    isSelf: true
  };
}

function hasLinkedAccounts(form: PersonIdentityForm): boolean {
  return Boolean(
    form.displayName ||
      form.githubLogin ||
      form.gitlabLogin ||
      form.slackHandle ||
      form.slackUserId ||
      form.workEmail ||
      form.personalEmail ||
      form.jiraEmail
  );
}

function IdentityField({
  label,
  value
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <label className="coop-settings-field-row">
      <span className="coop-settings-field-label">{label}</span>
      <span className="coop-settings-card-desc block py-2">{value || "—"}</span>
    </label>
  );
}

export function IdentityLinksDetail({ directory, signedIn }: IdentityLinksDetailProps): React.ReactElement {
  const selfForm = useMemo(() => {
    if (!signedIn) {
      return emptySelfForm();
    }
    const people = directory.people.map((person) => personFormFromRecord(person));
    const self = people.find((person) => person.isSelf) ?? people[0];
    return self ? { ...self, isSelf: true } : emptySelfForm();
  }, [directory, signedIn]);

  if (!signedIn) {
    return (
      <p className="coop-settings-card-desc px-0.5">
        Sign in under Settings → Account to view your linked profile. Identity data is cleared when you
        sign out.
      </p>
    );
  }

  const selfLinked = hasLinkedAccounts(selfForm);

  return (
    <>
      <p className="coop-settings-card-desc px-0.5">
        Your profile links are filled automatically from connected integrations and sign-in. Coop uses
        these mappings before any guessed name matching when resolving owners across GitHub, Slack, and Jira.
      </p>
      <p className="coop-settings-card-desc px-0.5 text-[var(--coop-panel-muted)]">
        Current directory: {identityDirectorySummary(directory)}
      </p>

      <SettingsSection
        title="You"
        description={
          selfLinked
            ? "Synced from your connected accounts — no manual entry needed."
            : "Connect GitHub, Slack, or Jira under Settings → Tools to populate this automatically."
        }
      >
        <IdentityField label="Display name" value={selfForm.displayName} />
        <IdentityField label="GitHub login" value={selfForm.githubLogin} />
        <IdentityField label="GitLab login" value={selfForm.gitlabLogin} />
        <IdentityField label="Slack handle" value={selfForm.slackHandle} />
        <IdentityField label="Slack user ID" value={selfForm.slackUserId} />
        <IdentityField label="Work email" value={selfForm.workEmail} />
        <IdentityField label="Personal email" value={selfForm.personalEmail} />
        <IdentityField label="Jira email" value={selfForm.jiraEmail} />
      </SettingsSection>
    </>
  );
}
