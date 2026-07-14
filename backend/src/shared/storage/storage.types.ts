import type { StorageEntityType, StorageModule, StorageVisibility } from "@prisma/client";

export type StorageProviderName = "local" | "cloudinary" | "google_drive";

export interface StorageObjectInput {
  buffer?: Buffer;
  fileName: string;
  mimeType: string;
  folder?: string;
  folderSegments?: string[];
  metadata?: Record<string, string>;
}

export interface StorageObjectResult {
  storageKey: string;
  publicUrl?: string;
  provider: StorageProviderName;
  driveFileId?: string;
  driveFolderId?: string;
  driveWebViewLink?: string;
  driveWebContentLink?: string;
  sizeBytes?: number;
}

export interface ManagedStorageObjectInput extends StorageObjectInput {
  module: StorageModule;
  entityType: StorageEntityType;
  entityId: string;
  employeeId?: string | null;
  attendancePunchId?: string | null;
  documentType?: string | null;
  visibility?: StorageVisibility;
  uploadedByUserId?: string | null;
  isThumbnail?: boolean;
  originalFileId?: string | null;
  purpose?: "general" | "punch-photo";
}

export interface StorageDownloadResult {
  buffer: Buffer;
  mimeType?: string;
  fileName?: string;
}

export interface StorageProvider {
  upload(input: StorageObjectInput): Promise<StorageObjectResult>;
  delete(storageKey: string): Promise<void>;
  getPublicUrl(storageKey: string): string | undefined;
  getFilePath(storageKey: string): string | undefined;
  download?(storageKey: string): Promise<StorageDownloadResult>;
}
