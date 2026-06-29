import { env } from "../../config/env";
import { cloudinaryStorageProvider } from "./cloudinaryStorage.provider";
import { localStorageProvider } from "./localStorage.provider";
import type { StorageObjectInput, StorageProvider } from "./storage.types";

function provider(): StorageProvider {
  if (env.STORAGE_PROVIDER === "cloudinary") return cloudinaryStorageProvider;
  return localStorageProvider;
}

export const storageService = {
  upload(input: StorageObjectInput) {
    return provider().upload(input);
  },

  delete(storageKey: string) {
    return provider().delete(storageKey);
  },

  getPublicUrl(storageKey: string) {
    return provider().getPublicUrl(storageKey);
  },

  getFilePath(storageKey: string) {
    return provider().getFilePath(storageKey);
  },
};
