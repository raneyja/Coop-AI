import {
  AnthropicIcon,
  BitbucketIcon,
  FireworksIcon,
  GitHubIcon,
  GitLabIcon,
  GoogleDocsIcon,
  GoogleIcon,
  JiraIcon,
  NotionIcon,
  OpenAIIcon,
  SlackIcon,
  TeamsIcon,
  type BrandLogoItem
} from "./brand-icons";

export const MODEL_PROVIDER_LOGOS: BrandLogoItem[] = [
  { name: "Anthropic", Icon: AnthropicIcon },
  { name: "OpenAI", Icon: OpenAIIcon },
  { name: "Google", Icon: GoogleIcon, colored: true },
  { name: "Fireworks.ai", Icon: FireworksIcon }
];

export const INTEGRATION_LOGOS: BrandLogoItem[] = [
  { name: "GitHub", Icon: GitHubIcon },
  { name: "GitLab", Icon: GitLabIcon },
  { name: "Bitbucket", Icon: BitbucketIcon },
  { name: "Slack", Icon: SlackIcon },
  { name: "Teams", Icon: TeamsIcon },
  { name: "Notion", Icon: NotionIcon },
  { name: "Google Docs", Icon: GoogleDocsIcon, colored: true },
  { name: "Jira", Icon: JiraIcon }
];
