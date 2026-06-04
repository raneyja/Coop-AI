export type WebhookProvider = "github" | "gitlab" | "bitbucket" | "slack";

export type RepositoryRef = {
  provider: Exclude<WebhookProvider, "slack">;
  repoId: string;
  owner: string;
  repo: string;
  defaultBranch?: string;
};

export type ChangedFile = {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "removed" | "renamed";
  size?: number;
  sha?: string;
  lastModified?: Date;
  lastAuthor?: string;
};

export type CommitSummary = {
  sha: string;
  message: string;
  author: string;
  date: Date;
  files: string[];
};

export type PullRequestMetadata = {
  id: string;
  number: number;
  title: string;
  state: string;
  author?: string;
  sourceBranch?: string;
  targetBranch?: string;
  updatedAt: Date;
  linkedIssues: string[];
};

export type IssueMetadata = {
  id: string;
  number: number;
  title: string;
  state: string;
  author?: string;
  updatedAt: Date;
  linkedFiles: string[];
};

export type ReviewMetadata = {
  id: string;
  pullRequestNumber: number;
  author?: string;
  state?: string;
  submittedAt: Date;
  comments: Array<{
    id: string;
    path?: string;
    line?: number;
    createdAt: Date;
  }>;
};

export type SlackDecisionMetadata = {
  id: string;
  teamId?: string;
  channelId?: string;
  userId?: string;
  timestamp: Date;
  decisionKeywords: string[];
  linkedRefs: Array<{
    provider: "github" | "gitlab";
    owner?: string;
    repo?: string;
    number?: number;
    sha?: string;
    url?: string;
  }>;
  reaction?: string;
};

export type NormalizedWebhookEvent =
  | {
      provider: "github" | "gitlab";
      deliveryId: string;
      receivedAt: Date;
      eventType: "push";
      repository: RepositoryRef;
      changedFiles: ChangedFile[];
      commits: CommitSummary[];
      ref?: string;
    }
  | {
      provider: "github" | "gitlab";
      deliveryId: string;
      receivedAt: Date;
      eventType: "pull_request" | "merge_request";
      repository: RepositoryRef;
      pullRequest: PullRequestMetadata;
      changedFiles: ChangedFile[];
    }
  | {
      provider: "github" | "gitlab";
      deliveryId: string;
      receivedAt: Date;
      eventType: "pull_request_review";
      repository: RepositoryRef;
      review: ReviewMetadata;
    }
  | {
      provider: "github" | "gitlab";
      deliveryId: string;
      receivedAt: Date;
      eventType: "issues" | "issue" | "wiki" | "repository";
      repository: RepositoryRef;
      issue?: IssueMetadata;
      repositoryAction?: string;
    }
  | {
      provider: "slack";
      deliveryId: string;
      receivedAt: Date;
      eventType: "message" | "app_mention" | "reaction";
      decision: SlackDecisionMetadata;
    };

export type WebhookHandlerResult = {
  accepted: boolean;
  duplicate: boolean;
  statusCode: number;
  message: string;
  event?: NormalizedWebhookEvent;
};

export type WebhookUpdateQueue = {
  enqueue(event: NormalizedWebhookEvent): Promise<void>;
};

export type WebhookVerificationResult = {
  ok: boolean;
  reason?: string;
};
