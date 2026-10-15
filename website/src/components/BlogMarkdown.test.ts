import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAllPosts, getPostBySlug } from "../lib/blog";
import { BlogMarkdown } from "./BlogMarkdown";

let checkedLinks = 0;
for (const meta of getAllPosts()) {
  const post = getPostBySlug(meta.slug);
  assert.ok(post, `${meta.slug}: published post must load`);
  const html = renderToStaticMarkup(createElement(BlogMarkdown, { content: post.content }));
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  for (const match of html.matchAll(/\bhref="#([^"]+)"/g)) {
    assert.ok(ids.has(match[1]), `${post.slug}: missing target for #${match[1]}`);
    checkedLinks++;
  }
}
assert.ok(checkedLinks >= 4, "The four support-engineer section links must be exercised");
console.log(`blog navigation: ${checkedLinks} section links resolve to rendered headings`);
