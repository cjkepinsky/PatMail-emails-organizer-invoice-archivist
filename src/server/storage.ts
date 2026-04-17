import fs from "node:fs/promises";
import path from "node:path";

export function sanitizePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function sanitizeFilename(value: string) {
  return value
    .trim()
    .replace(/[/:*?"<>|\\]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160);
}

export async function uniqueFilePath(directory: string, filename: string) {
  await fs.mkdir(directory, { recursive: true });
  const parsed = path.parse(filename);
  let candidate = path.join(directory, filename);
  let index = 2;
  while (await exists(candidate)) {
    candidate = path.join(directory, `${parsed.name}_${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
