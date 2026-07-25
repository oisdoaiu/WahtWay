import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  roots.push("client/be/data/skills", "server/data/skills");
}

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const colorPattern = /^#[0-9a-fA-F]{6}$/;
const schemaKeyPattern = /^[A-Za-z_][A-Za-z0-9_-]{0,79}$/;
const allowedOrigins = new Set(["builtin", "custom", "hub", "learned"]);
const allowedTopLevelKeys = new Set([
  "id",
  "name",
  "description",
  "systemPrompt",
  "input",
  "output",
  "requiredTools",
  "allowedTools",
  "whenToUse",
  "keywords",
  "modeCategory",
  "modeColor",
  "modeIcon",
  "welcomeMessage",
  "modeExamples",
  "version",
  "origin"
]);

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function add(errors, file, message) {
  errors.push(`${file}: ${message}`);
}

function checkString(errors, file, value, key, min, max) {
  if (typeof value !== "string") {
    add(errors, file, `${key} must be a string`);
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    add(errors, file, `${key} length must be ${min}-${max}`);
  }
}

function checkStringArray(errors, file, value, key, maxItems, maxLength, minItems = 0) {
  if (!Array.isArray(value)) {
    add(errors, file, `${key} must be a string array`);
    return;
  }
  if (value.length < minItems || value.length > maxItems) {
    add(errors, file, `${key} item count must be ${minItems}-${maxItems}`);
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") {
      add(errors, file, `${key} can only contain strings`);
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > maxLength) {
      add(errors, file, `${key} items must be 1-${maxLength} chars`);
    }
    if (seen.has(trimmed)) {
      add(errors, file, `${key} contains duplicate item: ${trimmed}`);
    }
    seen.add(trimmed);
  }
}

function checkSchemaProperty(errors, file, value, key) {
  if (!isObject(value)) {
    add(errors, file, `${key} must be an object`);
    return;
  }
  checkString(errors, file, value.type, `${key}.type`, 1, 40);
  checkString(errors, file, value.description, `${key}.description`, 1, 300);
  if (value.enum !== undefined) {
    checkStringArray(errors, file, value.enum, `${key}.enum`, 50, 80);
  }
}

function checkSchema(errors, file, value, key) {
  if (!isObject(value)) {
    add(errors, file, `${key} must be an object`);
    return;
  }
  checkString(errors, file, value.type, `${key}.type`, 1, 40);
  if (value.properties !== undefined) {
    if (!isObject(value.properties)) {
      add(errors, file, `${key}.properties must be an object`);
    } else {
      const entries = Object.entries(value.properties);
      if (entries.length > 50) add(errors, file, `${key}.properties has too many fields`);
      for (const [name, property] of entries) {
        if (!schemaKeyPattern.test(name)) {
          add(errors, file, `${key}.properties.${name} has invalid field name`);
        }
        checkSchemaProperty(errors, file, property, `${key}.properties.${name}`);
      }
    }
  }
  if (value.required !== undefined) {
    checkStringArray(errors, file, value.required, `${key}.required`, 50, 80);
  }
}

function validateManifest(file, manifest) {
  const errors = [];
  if (!isObject(manifest)) return [`${file}: manifest must be an object`];

  for (const key of Object.keys(manifest)) {
    if (!allowedTopLevelKeys.has(key)) add(errors, file, `unknown field: ${key}`);
  }

  for (const key of ["id", "name", "description", "systemPrompt", "input", "output", "requiredTools", "keywords"]) {
    if (manifest[key] === undefined) add(errors, file, `missing required field: ${key}`);
  }

  checkString(errors, file, manifest.id, "id", 3, 64);
  if (typeof manifest.id === "string" && !idPattern.test(manifest.id)) {
    add(errors, file, "id must be kebab-case");
  }
  const expectedFileName = `${manifest.id}.json`;
  if (typeof manifest.id === "string" && path.basename(file) !== expectedFileName) {
    add(errors, file, `file name should be ${expectedFileName}`);
  }

  checkString(errors, file, manifest.name, "name", 1, 80);
  checkString(errors, file, manifest.description, "description", 1, 500);
  checkString(errors, file, manifest.systemPrompt, "systemPrompt", 20, 20000);
  checkSchema(errors, file, manifest.input, "input");
  checkSchema(errors, file, manifest.output, "output");
  checkStringArray(errors, file, manifest.requiredTools, "requiredTools", 20, 80);
  checkStringArray(errors, file, manifest.keywords, "keywords", 30, 40, 1);

  if (manifest.allowedTools !== undefined) checkStringArray(errors, file, manifest.allowedTools, "allowedTools", 50, 80);
  if (manifest.whenToUse !== undefined) checkString(errors, file, manifest.whenToUse, "whenToUse", 1, 1000);
  if (manifest.modeCategory !== undefined) checkString(errors, file, manifest.modeCategory, "modeCategory", 1, 40);
  if (manifest.modeColor !== undefined && (typeof manifest.modeColor !== "string" || !colorPattern.test(manifest.modeColor))) {
    add(errors, file, "modeColor must be a 6-digit hex color");
  }
  if (manifest.modeIcon !== undefined) checkString(errors, file, manifest.modeIcon, "modeIcon", 1, 8);
  if (manifest.welcomeMessage !== undefined) checkString(errors, file, manifest.welcomeMessage, "welcomeMessage", 1, 160);
  if (manifest.modeExamples !== undefined) checkStringArray(errors, file, manifest.modeExamples, "modeExamples", 4, 80);
  if (manifest.version !== undefined && (!Number.isInteger(manifest.version) || manifest.version < 1)) {
    add(errors, file, "version must be an integer >= 1");
  }
  if (manifest.origin !== undefined && !allowedOrigins.has(manifest.origin)) {
    add(errors, file, "origin must be builtin, custom, hub, or learned");
  }

  if (Buffer.byteLength(JSON.stringify(manifest), "utf8") > 256 * 1024) {
    add(errors, file, "manifest must be <= 256KB");
  }

  return errors;
}

function collectJsonFiles(root) {
  const stat = fs.statSync(root);
  if (stat.isFile()) return root.endsWith(".json") ? [root] : [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...collectJsonFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith(".json")) result.push(fullPath);
  }
  return result;
}

const files = roots.flatMap((root) => collectJsonFiles(root));
const allErrors = [];

for (const file of files) {
  try {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    allErrors.push(...validateManifest(file, manifest));
  } catch (error) {
    allErrors.push(`${file}: invalid JSON: ${error.message}`);
  }
}

if (allErrors.length > 0) {
  console.error(`Skill format validation failed (${allErrors.length} errors):`);
  for (const error of allErrors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Skill format validation passed: ${files.length} file(s)`);

