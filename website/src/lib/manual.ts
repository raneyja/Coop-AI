import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { extractToc, type ManualContent } from "@/lib/manual.shared";

const manualPath = path.join(process.cwd(), "content/manual/index.md");

export function getManual(): ManualContent {
  const fileContents = fs.readFileSync(manualPath, "utf8");
  const { data, content } = matter(fileContents);

  return {
    title: String(data.title ?? "Coop AI Owner's Manual"),
    description: String(data.description ?? ""),
    lastUpdated: String(data.lastUpdated ?? ""),
    content,
    toc: extractToc(content)
  };
}
