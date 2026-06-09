import React, { useEffect, useMemo, useState } from "react";
import {
  identityDirectorySummary,
  personFormFromRecord,
  personRecordFromForm
} from "../../../identity/identityDirectory";
import type { IdentityDirectory, PersonIdentityForm } from "../../../identity/types";
import { SettingsSection } from "./SettingsShared";

type IdentityLinksDetailProps = {
  directory: IdentityDirectory;
  onSave: (directory: IdentityDirectory) => void;
};

function emptyPerson(self = false): PersonIdentityForm {
  return {
    id: `person-${Date.now().toString(36)}`,
    displayName: "",
    githubLogin: "",
    gitlabLogin: "",
    slackHandle: "",
    slackUserId: "",
    workEmail: "",
    personalEmail: "",
    jiraEmail: "",
    isSelf: self
  };
}

export function IdentityLinksDetail({ directory, onSave }: IdentityLinksDetailProps): React.ReactElement {
  const initialForms = useMemo(
    () =>
      directory.people.length > 0
        ? directory.people.map((person) => personFormFromRecord(person))
        : [emptyPerson(true)],
    [directory]
  );
  const [forms, setForms] = useState<PersonIdentityForm[]>(initialForms);

  useEffect(() => {
    setForms(initialForms);
  }, [initialForms]);

  const updateForm = (id: string, patch: Partial<PersonIdentityForm>) => {
    setForms((current) => current.map((form) => (form.id === id ? { ...form, ...patch } : form)));
  };

  const addPerson = () => {
    setForms((current) => [...current, emptyPerson()]);
  };

  const removePerson = (id: string) => {
    setForms((current) => (current.length <= 1 ? current : current.filter((form) => form.id !== id)));
  };

  const save = () => {
    const people = forms
      .map((form) => personRecordFromForm(form))
      .filter((person) => person.displayName.length > 0);
    onSave({ version: 1, people });
  };

  return (
    <>
      <p className="coop-settings-card-desc px-0.5">
        Link each engineer&apos;s tool accounts explicitly. Coop uses these mappings before any guessed
        name matching — personal GitHub, company Slack, and different emails are expected.
      </p>
      <p className="coop-settings-card-desc px-0.5 text-[var(--coop-panel-muted)]">
        Current directory: {identityDirectorySummary(directory)}
      </p>

      {forms.map((form, index) => (
        <SettingsSection
          key={form.id}
          title={form.isSelf ? "You" : `Person ${index + 1}`}
          description="Map code-host login, Slack handle, and work email for the same human."
        >
          <label className="coop-settings-field-row">
            <span className="coop-settings-field-label">Display name</span>
            <input
              className="coop-settings-field"
              value={form.displayName}
              placeholder="Jon Raney"
              onChange={(e) => updateForm(form.id, { displayName: e.target.value })}
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-field-label">GitHub login</span>
            <input
              className="coop-settings-field"
              value={form.githubLogin}
              placeholder="raneyja"
              onChange={(e) => updateForm(form.id, { githubLogin: e.target.value })}
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-field-label">GitLab login</span>
            <input
              className="coop-settings-field"
              value={form.gitlabLogin}
              placeholder="optional"
              onChange={(e) => updateForm(form.id, { gitlabLogin: e.target.value })}
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-field-label">Slack handle</span>
            <input
              className="coop-settings-field"
              value={form.slackHandle}
              placeholder="jon"
              onChange={(e) => updateForm(form.id, { slackHandle: e.target.value })}
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-field-label">Slack user ID</span>
            <input
              className="coop-settings-field"
              value={form.slackUserId}
              placeholder="U012ABCDEF (optional)"
              onChange={(e) => updateForm(form.id, { slackUserId: e.target.value })}
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-field-label">Work email</span>
            <input
              className="coop-settings-field"
              type="email"
              value={form.workEmail}
              placeholder="jon@coop-ai.dev"
              onChange={(e) => updateForm(form.id, { workEmail: e.target.value })}
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-field-label">Personal email</span>
            <input
              className="coop-settings-field"
              type="email"
              value={form.personalEmail}
              placeholder="jonathanaraney@gmail.com (optional)"
              onChange={(e) => updateForm(form.id, { personalEmail: e.target.value })}
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-field-label">Jira email</span>
            <input
              className="coop-settings-field"
              type="email"
              value={form.jiraEmail}
              placeholder="optional"
              onChange={(e) => updateForm(form.id, { jiraEmail: e.target.value })}
            />
          </label>
          {!form.isSelf ? (
            <button type="button" className="coop-text-btn" onClick={() => removePerson(form.id)}>
              Remove person
            </button>
          ) : null}
        </SettingsSection>
      ))}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="coop-settings-action-btn" onClick={save}>
          Save identity links
        </button>
        <button type="button" className="coop-text-btn" onClick={addPerson}>
          Add person
        </button>
      </div>
    </>
  );
}
