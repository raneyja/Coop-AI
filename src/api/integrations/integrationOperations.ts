import type { SlackClient } from "../slack/slackClient";
import type { JiraClient } from "../jira/jiraClient";
import type { ConfluenceClient } from "../confluence/confluenceClient";
import type { NotionClient } from "../notion/notionClient";
import type { GoogleDocsClient } from "../googleDocs/googleDocsClient";
import type { TeamsClient } from "../teams/teamsClient";

export type IntegrationOperations = {
  "slack.testConnection": { args: Parameters<SlackClient["testConnection"]>; result: Awaited<ReturnType<SlackClient["testConnection"]>> };
  "slack.searchMessages": { args: Parameters<SlackClient["searchMessages"]>; result: Awaited<ReturnType<SlackClient["searchMessages"]>> };
  "slack.getThread": { args: Parameters<SlackClient["getThread"]>; result: Awaited<ReturnType<SlackClient["getThread"]>> };
  "slack.getUserInfo": { args: Parameters<SlackClient["getUserInfo"]>; result: Awaited<ReturnType<SlackClient["getUserInfo"]>> };
  "slack.getUserPresence": { args: Parameters<SlackClient["getUserPresence"]>; result: Awaited<ReturnType<SlackClient["getUserPresence"]>> };
  "slack.findUserByEmail": { args: Parameters<SlackClient["findUserByEmail"]>; result: Awaited<ReturnType<SlackClient["findUserByEmail"]>> };
  "slack.findUserByName": { args: Parameters<SlackClient["findUserByName"]>; result: Awaited<ReturnType<SlackClient["findUserByName"]>> };
  "slack.getChannelInfo": { args: Parameters<SlackClient["getChannelInfo"]>; result: Awaited<ReturnType<SlackClient["getChannelInfo"]>> };
  "jira.testConnection": { args: Parameters<JiraClient["testConnection"]>; result: Awaited<ReturnType<JiraClient["testConnection"]>> };
  "jira.getIssue": { args: Parameters<JiraClient["getIssue"]>; result: Awaited<ReturnType<JiraClient["getIssue"]>> };
  "jira.getEpic": { args: Parameters<JiraClient["getEpic"]>; result: Awaited<ReturnType<JiraClient["getEpic"]>> };
  "jira.searchIssues": { args: Parameters<JiraClient["searchIssues"]>; result: Awaited<ReturnType<JiraClient["searchIssues"]>> };
  "jira.getTransitionHistory": { args: Parameters<JiraClient["getTransitionHistory"]>; result: Awaited<ReturnType<JiraClient["getTransitionHistory"]>> };
  "confluence.testConnection": { args: Parameters<ConfluenceClient["testConnection"]>; result: Awaited<ReturnType<ConfluenceClient["testConnection"]>> };
  "confluence.searchPages": { args: Parameters<ConfluenceClient["searchPages"]>; result: Awaited<ReturnType<ConfluenceClient["searchPages"]>> };
  "confluence.getPageBody": { args: Parameters<ConfluenceClient["getPageBody"]>; result: Awaited<ReturnType<ConfluenceClient["getPageBody"]>> };
  "notion.testConnection": { args: Parameters<NotionClient["testConnection"]>; result: Awaited<ReturnType<NotionClient["testConnection"]>> };
  "notion.searchPages": { args: Parameters<NotionClient["searchPages"]>; result: Awaited<ReturnType<NotionClient["searchPages"]>> };
  "notion.getPagePlainText": { args: Parameters<NotionClient["getPagePlainText"]>; result: Awaited<ReturnType<NotionClient["getPagePlainText"]>> };
  "googleDocs.testConnection": { args: Parameters<GoogleDocsClient["testConnection"]>; result: Awaited<ReturnType<GoogleDocsClient["testConnection"]>> };
  "googleDocs.searchDocumentsForTerms": { args: Parameters<GoogleDocsClient["searchDocumentsForTerms"]>; result: Awaited<ReturnType<GoogleDocsClient["searchDocumentsForTerms"]>> };
  "googleDocs.searchDocuments": { args: Parameters<GoogleDocsClient["searchDocuments"]>; result: Awaited<ReturnType<GoogleDocsClient["searchDocuments"]>> };
  "googleDocs.getDocument": { args: Parameters<GoogleDocsClient["getDocument"]>; result: Awaited<ReturnType<GoogleDocsClient["getDocument"]>> };
  "googleDocs.listRecentDocuments": { args: Parameters<GoogleDocsClient["listRecentDocuments"]>; result: Awaited<ReturnType<GoogleDocsClient["listRecentDocuments"]>> };
  "googleDocs.getDocumentPlainText": { args: Parameters<GoogleDocsClient["getDocumentPlainText"]>; result: Awaited<ReturnType<GoogleDocsClient["getDocumentPlainText"]>> };
  "teams.testConnection": { args: Parameters<TeamsClient["testConnection"]>; result: Awaited<ReturnType<TeamsClient["testConnection"]>> };
  "teams.searchMessages": { args: Parameters<TeamsClient["searchMessages"]>; result: Awaited<ReturnType<TeamsClient["searchMessages"]>> };
  "teams.getThread": { args: Parameters<TeamsClient["getThread"]>; result: Awaited<ReturnType<TeamsClient["getThread"]>> };
  "teams.getUserInfo": { args: Parameters<TeamsClient["getUserInfo"]>; result: Awaited<ReturnType<TeamsClient["getUserInfo"]>> };
};

export type IntegrationOperation = keyof IntegrationOperations;
export type IntegrationProxy = <K extends IntegrationOperation>(
  operation: K, args: IntegrationOperations[K]["args"], signal?: AbortSignal
) => Promise<IntegrationOperations[K]["result"]>;

export const INTEGRATION_OPERATION_ARITY: Record<IntegrationOperation, [number, number]> = {
  "slack.testConnection": [0, 0],
  "slack.searchMessages": [1, 2],
  "slack.getThread": [2, 2],
  "slack.getUserInfo": [1, 1],
  "slack.getUserPresence": [1, 1],
  "slack.findUserByEmail": [1, 1],
  "slack.findUserByName": [1, 1],
  "slack.getChannelInfo": [1, 1],
  "jira.testConnection": [0, 0],
  "jira.getIssue": [1, 1],
  "jira.getEpic": [1, 1],
  "jira.searchIssues": [1, 2],
  "jira.getTransitionHistory": [1, 1],
  "confluence.testConnection": [0, 0],
  "confluence.searchPages": [1, 2],
  "confluence.getPageBody": [1, 1],
  "notion.testConnection": [0, 0],
  "notion.searchPages": [1, 2],
  "notion.getPagePlainText": [1, 1],
  "googleDocs.testConnection": [0, 0],
  "googleDocs.searchDocumentsForTerms": [1, 3],
  "googleDocs.searchDocuments": [1, 3],
  "googleDocs.getDocument": [1, 1],
  "googleDocs.listRecentDocuments": [0, 2],
  "googleDocs.getDocumentPlainText": [1, 1],
  "teams.testConnection": [0, 0],
  "teams.searchMessages": [1, 2],
  "teams.getThread": [3, 3],
  "teams.getUserInfo": [1, 1],
};
