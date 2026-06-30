export type CapabilityItem = {
  title: string;
  body: string;
};

export type CapabilityGroup = {
  label: string;
  items: CapabilityItem[];
};

export const productCapabilityGroups: CapabilityGroup[] = [
  {
    label: "indexing",
    items: [
      {
        title: "Remote knowledge graph",
        body: "CoopAI indexes repositories via webhooks and background jobs. The extension queries ownership, dependents, and decision signals without requiring a full local clone."
      },
      {
        title: "Graceful degradation",
        body: "When graph data is unavailable, CoopAI falls back transparently and tells you what context is missing instead of hallucinating."
      }
    ]
  },
  {
    label: "write",
    items: [
      {
        title: "Inline complete & edit",
        body: "Ghost-text completions and selection-based edits in the open file. Optional graph context (Pro) and project-style biasing keep suggestions aligned with your codebase — craftsmanship in the editor, not autonomous agents."
      },
      {
        title: "Completion-only routing",
        body: "Inline requests use a dedicated zero-retention path (`x-use-case: code-completion-only`) — separate from chat, with keys on your server."
      }
    ]
  },
  {
    label: "team_context",
    items: [
      {
        title: "Editor context menu",
        body: "Right-click any selection to Trace Decision, Find Owner, Blast Radius, Understand Repo, or surface Knowledge Gaps."
      },
      {
        title: "Workspace prompt library",
        body: "Save and share team prompts in `.coop/prompts.json`. Run common workflows from the sidebar or context menu with one click."
      },
      {
        title: "Slack & ticket context",
        body: "CoopAI connects organizational context — Slack threads, tickets, and PR history — so answers reflect how decisions were actually made."
      }
    ]
  },
  {
    label: "platform",
    items: [
      {
        title: "Multi-model chat",
        body: "Stream responses from Anthropic, OpenAI, Gemini, and more. Provider keys live on your CoopAI server — never in the IDE or on developer laptops."
      }
    ]
  }
];
