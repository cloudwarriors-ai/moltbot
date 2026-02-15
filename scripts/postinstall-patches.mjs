#!/usr/bin/env node
/**
 * Apply patches to node_modules that need to survive pnpm install.
 * Run via: node scripts/postinstall-patches.mjs
 *
 * Patches:
 * - pi-agent-core: trim tool names before lookup (LLMs sometimes emit leading spaces)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Find the pi-agent-core agent-loop.js in node_modules
const candidates = [
  "node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js",
];

// Also check pnpm store paths
const pnpmDir = path.join(root, "node_modules", ".pnpm");
if (fs.existsSync(pnpmDir)) {
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (entry.startsWith("@mariozechner+pi-agent-core")) {
      candidates.push(
        path.join(".pnpm", entry, "node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js"),
      );
    }
  }
}

let patched = 0;
for (const rel of candidates) {
  const filePath = path.join(root, "node_modules", rel);
  if (!fs.existsSync(filePath)) continue;

  let content = fs.readFileSync(filePath, "utf-8");
  const marker = "toolCall.name = toolCall.name.trim()";
  if (content.includes(marker)) {
    console.log(`  [skip] ${rel} (already patched)`);
    continue;
  }

  const target = `const toolCall = toolCalls[index];\n        const tool = tools?.find`;
  const replacement = `const toolCall = toolCalls[index];\n        if (typeof toolCall.name === "string") toolCall.name = toolCall.name.trim();\n        const tool = tools?.find`;

  if (!content.includes(target)) {
    console.log(`  [warn] ${rel} (pattern not found — SDK may have changed)`);
    continue;
  }

  content = content.replace(target, replacement);
  fs.writeFileSync(filePath, content, "utf-8");
  patched++;
  console.log(`  [patch] ${rel} — tool name trim applied`);
}

if (patched > 0) {
  console.log(`Applied ${patched} patch(es) to pi-agent-core`);
} else {
  console.log("No patches needed (already applied or pattern not found)");
}
