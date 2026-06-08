import { CODE_CREATION_STORIES, type CodeCreationStory } from "@/lib/codeCreationScenarios";
import { FILE_CONTEXT_STORIES, type InquiryStory } from "@/lib/fileContextStoryScenarios";

export type DemoStory = InquiryStory | CodeCreationStory;

/** Homepage + file-context demo rotation: inquiry and code creation interleaved */
export const DEMO_STORIES: DemoStory[] = [
  FILE_CONTEXT_STORIES[0],
  CODE_CREATION_STORIES[0],
  FILE_CONTEXT_STORIES[1],
  CODE_CREATION_STORIES[1]
];

export function isInquiryStory(story: DemoStory): story is InquiryStory {
  return story.kind === "inquiry";
}

export function isCodeCreationStory(story: DemoStory): story is CodeCreationStory {
  return story.kind === "complete" || story.kind === "edit";
}
