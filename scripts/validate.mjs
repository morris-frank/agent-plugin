#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const errors = [];
const warnings = [];

const pluginNamePattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const marketplaceNamePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const CANONICAL_MARKETPLACE = "marketplace.json";

const MARKETPLACE_SYMLINKS = [
  { label: "Cursor", file: ".cursor-plugin/marketplace.json" },
  { label: "Claude", file: ".claude-plugin/marketplace.json" },
  { label: "Codex", file: ".agents/plugins/marketplace.json" },
];

const PLUGIN_MANIFEST_DIRS = [".cursor-plugin", ".claude-plugin", ".codex-plugin"];

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(targetPath, context) {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      addError(`${context} exists but is not a directory: ${targetPath}`);
      return false;
    }
    return true;
  } catch {
    addError(`${context} directory is missing: ${targetPath}`);
    return false;
  }
}

async function readJsonFile(filePath, context) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    addError(`${context} is missing: ${filePath}`);
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    addError(`${context} contains invalid JSON (${filePath}): ${error.message}`);
    return null;
  }
}

function normalizeNewlines(content) {
  return content.replace(/\r\n/g, "\n");
}

function parseFrontmatter(content) {
  const normalized = normalizeNewlines(content);
  if (!normalized.startsWith("---\n")) {
    return null;
  }

  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return null;
  }

  const frontmatterBlock = normalized.slice(4, closingIndex);
  const fields = {};

  for (const line of frontmatterBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    fields[key] = value;
  }

  return fields;
}

async function walkFiles(dirPath) {
  const files = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return true;
  }
  if (path.isAbsolute(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  return !normalized.startsWith("../") && normalized !== "..";
}

function extractPathValues(value) {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractPathValues(entry));
  }

  if (value && typeof value === "object") {
    const candidates = [];
    if (typeof value.path === "string") {
      candidates.push(value.path);
    }
    if (typeof value.file === "string") {
      candidates.push(value.file);
    }
    return candidates;
  }

  return [];
}

function resolveMarketplaceSource(source, pluginRoot) {
  if (typeof source === "string" && source.length > 0) {
    if (!pluginRoot) {
      return source;
    }
    const normalizedRoot = pluginRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedSource = source.replace(/\\/g, "/");
    if (normalizedSource === normalizedRoot || normalizedSource.startsWith(`${normalizedRoot}/`)) {
      return normalizedSource;
    }
    return `${normalizedRoot}/${normalizedSource}`;
  }

  if (source && typeof source === "object" && typeof source.path === "string") {
    return source.path;
  }

  return null;
}

async function validateReferencedPath(pluginDir, fieldName, pathValue, pluginName) {
  if (pathValue.startsWith("http://") || pathValue.startsWith("https://")) {
    return;
  }

  if (!isSafeRelativePath(pathValue)) {
    addError(
      `${pluginName}: field "${fieldName}" has invalid path "${pathValue}". Use a relative path without ".." or absolute prefixes.`
    );
    return;
  }

  const resolved = path.resolve(pluginDir, pathValue);
  const exists = await pathExists(resolved);
  if (!exists) {
    addError(`${pluginName}: field "${fieldName}" references missing path "${pathValue}".`);
  }
}

async function validateFrontmatterFile(filePath, componentName, requiredKeys, pluginName) {
  const content = await fs.readFile(filePath, "utf8");
  const parsed = parseFrontmatter(content);
  const relativeFile = path.relative(repoRoot, filePath);

  if (!parsed) {
    addError(`${pluginName}: ${componentName} file missing YAML frontmatter: ${relativeFile}`);
    return;
  }

  for (const key of requiredKeys) {
    if (!parsed[key] || parsed[key].length === 0) {
      addError(`${pluginName}: ${componentName} file missing "${key}" in frontmatter: ${relativeFile}`);
    }
  }
}

async function validateComponentFrontmatter(pluginDir, pluginName) {
  const rulesDir = path.join(pluginDir, "rules");
  if (await pathExists(rulesDir)) {
    const files = await walkFiles(rulesDir);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (ext === ".md" || ext === ".mdc" || ext === ".markdown") {
        await validateFrontmatterFile(file, "rule", ["description"], pluginName);
      }
    }
  }

  const skillsDir = path.join(pluginDir, "skills");
  if (await pathExists(skillsDir)) {
    const files = await walkFiles(skillsDir);
    for (const file of files) {
      if (path.basename(file) === "SKILL.md") {
        await validateFrontmatterFile(file, "skill", ["name", "description"], pluginName);
      }
    }
  }

  const agentsDir = path.join(pluginDir, "agents");
  if (await pathExists(agentsDir)) {
    const files = await walkFiles(agentsDir);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (ext === ".md" || ext === ".mdc" || ext === ".markdown") {
        await validateFrontmatterFile(file, "agent", ["name", "description"], pluginName);
      }
    }
  }

  const commandsDir = path.join(pluginDir, "commands");
  if (await pathExists(commandsDir)) {
    const files = await walkFiles(commandsDir);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (ext === ".md" || ext === ".mdc" || ext === ".markdown" || ext === ".txt") {
        await validateFrontmatterFile(file, "command", ["name", "description"], pluginName);
      }
    }
  }
}

async function validatePluginManifests(pluginDir, pluginName) {
  const manifests = [];

  for (const dir of PLUGIN_MANIFEST_DIRS) {
    const manifestPath = path.join(pluginDir, dir, "plugin.json");
    if (await pathExists(manifestPath)) {
      manifests.push({ dir, path: manifestPath });
    } else {
      addError(`${pluginName}: missing ${dir}/plugin.json`);
    }
  }

  let canonicalName = null;

  for (const { dir, path: manifestPath } of manifests) {
    const pluginManifest = await readJsonFile(manifestPath, `${pluginName} ${dir} manifest`);
    if (!pluginManifest) {
      continue;
    }

    if (typeof pluginManifest.name !== "string" || !pluginNamePattern.test(pluginManifest.name)) {
      addError(
        `${pluginName}: "name" in ${dir}/plugin.json must be lowercase and use only alphanumerics, hyphens, and periods.`
      );
    } else {
      if (!canonicalName) {
        canonicalName = pluginManifest.name;
      } else if (pluginManifest.name !== canonicalName) {
        addError(
          `${pluginName}: manifest names disagree (${canonicalName} vs ${pluginManifest.name} in ${dir}).`
        );
      }
    }

    const manifestFields = ["logo", "rules", "skills", "agents", "commands", "hooks", "mcpServers"];
    for (const field of manifestFields) {
      const values = extractPathValues(pluginManifest[field]);
      for (const value of values) {
        await validateReferencedPath(pluginDir, `${dir}.${field}`, value, pluginName);
      }
    }

    if (dir === ".codex-plugin" && !pluginManifest.interface) {
      addWarning(`${pluginName}: .codex-plugin/plugin.json has no "interface" block (recommended for Codex UI).`);
    }
  }

  if (canonicalName && canonicalName !== pluginName) {
    addError(
      `${pluginName}: marketplace entry name does not match plugin manifest name ("${canonicalName}").`
    );
  }

  await validateComponentFrontmatter(pluginDir, pluginName);
  await validateSharedSymlinks(pluginDir, pluginName);
}

async function validateSharedSymlinks(pluginDir, pluginName) {
  const mcpCanonical = path.join(pluginDir, ".mcp.json");
  const mcpCursor = path.join(pluginDir, "mcp.json");
  const cursorManifest = path.join(pluginDir, ".cursor-plugin", "plugin.json");
  const claudeManifest = path.join(pluginDir, ".claude-plugin", "plugin.json");

  if (await pathExists(mcpCanonical)) {
    try {
      const stat = await fs.lstat(mcpCursor);
      if (!stat.isSymbolicLink()) {
        addError(`${pluginName}: mcp.json must be a symlink to .mcp.json.`);
      } else {
        const target = path.resolve(path.dirname(mcpCursor), await fs.readlink(mcpCursor));
        if (target !== mcpCanonical) {
          addError(`${pluginName}: mcp.json must symlink to .mcp.json.`);
        }
      }
    } catch {
      addError(`${pluginName}: missing mcp.json symlink to .mcp.json.`);
    }
  }

  if ((await pathExists(cursorManifest)) && (await pathExists(claudeManifest))) {
    try {
      const stat = await fs.lstat(cursorManifest);
      if (!stat.isSymbolicLink()) {
        addWarning(
          `${pluginName}: .cursor-plugin/plugin.json should symlink to .claude-plugin/plugin.json when manifests match.`
        );
      } else {
        const target = path.resolve(path.dirname(cursorManifest), await fs.readlink(cursorManifest));
        if (target !== claudeManifest) {
          addWarning(
            `${pluginName}: .cursor-plugin/plugin.json should symlink to .claude-plugin/plugin.json.`
          );
        }
      }
    } catch {
      // covered by manifest missing errors
    }
  }
}

async function validateMarketplaceSymlinks() {
  const canonicalPath = path.join(repoRoot, CANONICAL_MARKETPLACE);

  for (const { label, file } of MARKETPLACE_SYMLINKS) {
    const symlinkPath = path.join(repoRoot, file);

    try {
      const stat = await fs.lstat(symlinkPath);
      if (!stat.isSymbolicLink()) {
        addError(`${label}: ${file} must be a symlink to ${CANONICAL_MARKETPLACE}.`);
        continue;
      }

      const target = path.resolve(path.dirname(symlinkPath), await fs.readlink(symlinkPath));
      if (target !== canonicalPath) {
        addError(`${label}: ${file} must symlink to ${CANONICAL_MARKETPLACE}.`);
      }
    } catch {
      addError(`${label}: missing ${file} symlink to ${CANONICAL_MARKETPLACE}.`);
    }
  }
}

async function validateMarketplace() {
  const marketplacePath = path.join(repoRoot, CANONICAL_MARKETPLACE);
  const marketplace = await readJsonFile(marketplacePath, "Marketplace manifest");
  if (!marketplace) {
    return;
  }

  if (typeof marketplace.name !== "string" || !marketplaceNamePattern.test(marketplace.name)) {
    addError(
      'Marketplace "name" must be lowercase kebab-case and start/end with an alphanumeric character.'
    );
  }

  if (!marketplace.owner || typeof marketplace.owner.name !== "string" || marketplace.owner.name.length === 0) {
    addError('Marketplace "owner.name" is required.');
  }

  if (
    typeof marketplace.description !== "string" ||
    marketplace.description.length === 0 ||
    typeof marketplace.metadata?.description !== "string" ||
    marketplace.metadata.description.length === 0
  ) {
    addWarning('Marketplace should include both "description" and "metadata.description".');
  }

  if (!marketplace.interface?.displayName) {
    addWarning('Marketplace should include "interface.displayName" for Codex.');
  }

  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    addError('Marketplace "plugins" must be a non-empty array.');
    return;
  }

  const pluginRoot = marketplace.metadata?.pluginRoot;
  if (pluginRoot !== undefined) {
    if (typeof pluginRoot !== "string" || !isSafeRelativePath(pluginRoot)) {
      addError('Marketplace "metadata.pluginRoot" must be a safe relative path.');
    } else {
      const pluginRootAbs = path.join(repoRoot, pluginRoot);
      await ensureDirectory(pluginRootAbs, 'Marketplace "metadata.pluginRoot"');
    }
  }

  const seenNames = new Set();

  for (const [index, entry] of marketplace.plugins.entries()) {
    const entryLabel = `plugins[${index}]`;

    if (!entry || typeof entry !== "object") {
      addError(`${entryLabel} must be an object.`);
      continue;
    }

    if (typeof entry.name !== "string" || !pluginNamePattern.test(entry.name)) {
      addError(`${entryLabel}.name must be lowercase and use only alphanumerics, hyphens, and periods.`);
      continue;
    }

    if (seenNames.has(entry.name)) {
      addError(`Duplicate plugin name "${entry.name}" in marketplace manifest.`);
    }
    seenNames.add(entry.name);

    const sourcePath = resolveMarketplaceSource(entry.source, pluginRoot ?? "");
    if (!sourcePath) {
      addError(`${entryLabel}.source must be a string path (or Codex object with path).`);
      continue;
    }
    if (!isSafeRelativePath(sourcePath)) {
      addError(`${entryLabel}.source is not a safe relative path: "${sourcePath}"`);
      continue;
    }

    if (!entry.policy?.installation || !entry.policy?.authentication) {
      addError(`${entryLabel} requires policy.installation and policy.authentication for Codex.`);
    }
    if (!entry.category) {
      addError(`${entryLabel} requires category for Codex.`);
    }

    const pluginDir = path.join(repoRoot, sourcePath);
    const pluginDirExists = await ensureDirectory(pluginDir, `${entryLabel}.source`);
    if (pluginDirExists) {
      await validatePluginManifests(pluginDir, entry.name);
    }
  }
}

async function main() {
  await validateMarketplaceSymlinks();
  await validateMarketplace();
  summarizeAndExit();
}

function summarizeAndExit() {
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
    console.log("");
  }

  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Validation passed.");
}

await main();
