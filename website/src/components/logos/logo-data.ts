import {
  AnthropicIcon,
  BitbucketIcon,
  ConfluenceIcon,
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
  { name: "Google", Icon: GoogleIcon },
  { name: "Fireworks.ai", Icon: FireworksIcon, wide: true }
];

export const INTEGRATION_LOGOS: BrandLogoItem[] = [
  { name: "GitHub", Icon: GitHubIcon },
  { name: "GitLab", Icon: GitLabIcon },
  { name: "Bitbucket", Icon: BitbucketIcon },
  { name: "Slack", Icon: SlackIcon },
  { name: "Teams", Icon: TeamsIcon },
  { name: "Jira", Icon: JiraIcon },
  { name: "Confluence", Icon: ConfluenceIcon },
  { name: "Notion", Icon: NotionIcon },
  { name: "Google Docs", Icon: GoogleDocsIcon }
];
