import type { StorageObjectInput, StorageObjectResult, StorageProvider } from "./storage.types";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const uploadRoot = path.join(process.cwd(), "uploads");

function safeFileName(fileName: string) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function safeFolder(folder?: string) {
  return (folder || "pending-local")
    .split(/[\\/]+/)
    .map((part) => safeFileName(part))
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function filePathFor(storageKey: string) {
  const folder = safeFolder(path.dirname(storageKey));
  const fileName = safeFileName(path.basename(storageKey));
  if (!fileName || fileName === "." || fileName === "..") return undefined;

  const root = path.resolve(uploadRoot);
  const target = path.resolve(root, folder, fileName);
  if (!target.startsWith(`${root}${path.sep}`)) return undefined;
  return target;
}

export const localStorageProvider: StorageProvider = {
  async upload(input: StorageObjectInput): Promise<StorageObjectResult> {
    const folder = safeFolder(input.folder);
    const fileName = `${Date.now()}-${safeFileName(input.fileName) || "documento"}`;
    const key = `${folder}/${fileName}`;

    if (input.buffer) {
      const targetDir = path.join(uploadRoot, folder);
      await mkdir(targetDir, { recursive: true });
      await writeFile(path.join(targetDir, fileName), input.buffer);
    }

    return {
      storageKey: key,
      provider: "local",
    };
  },

  async delete(storageKey: string) {
    const target = filePathFor(storageKey);
    if (!target) return undefined;
    await unlink(target).catch(() => undefined);
  },

  getPublicUrl() {
    return undefined;
  },

  getFilePath(storageKey: string) {
    return filePathFor(storageKey);
  },
};
