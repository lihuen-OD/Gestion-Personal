export type StorageProviderName = "local" | "cloudinary";

export interface StorageObjectInput {
  buffer?: Buffer;
  fileName: string;
  mimeType: string;
  folder?: string;
  metadata?: Record<string, string>;
}

export interface StorageObjectResult {
  storageKey: string;
  publicUrl?: string;
  provider: StorageProviderName;
}

export interface StorageProvider {
  upload(input: StorageObjectInput): Promise<StorageObjectResult>;
  delete(storageKey: string): Promise<void>;
  getPublicUrl(storageKey: string): string | undefined;
  getFilePath(storageKey: string): string | undefined;
}
