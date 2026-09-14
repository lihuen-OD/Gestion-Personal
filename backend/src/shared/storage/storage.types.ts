import type {
  StorageEntityType,
  StorageModule,
  StorageProvider as PersistedStorageProvider,
  StorageVisibility,
} from "@prisma/client";

export type { PersistedStorageProvider };

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
  /**
   * @deprecated (Etapa 15D.3) URL informativa devuelta por el provider al
   * subir — nunca usar para armar una respuesta de descarga/redirect al
   * cliente. Ver docs/decisions/CLOUDINARY_SECURE_DELIVERY_15D3.md.
   */
  publicUrl?: string;
  provider: StorageProviderName;
  driveFileId?: string;
  driveFolderId?: string;
  driveWebViewLink?: string;
  driveWebContentLink?: string;
  sizeBytes?: number;
  // Etapa 15D.3: metadata real que Cloudinary devuelve al subir (varía por
  // archivo porque el upload usa resource_type=auto) — se persiste en
  // StorageFile.metadata para poder resolver download/delete después con
  // el resource_type/delivery type correctos, sin asumir uno fijo.
  cloudinaryResourceType?: string;
  cloudinaryDeliveryType?: string;
  cloudinaryAssetId?: string;
  cloudinaryVersion?: string;
  cloudinaryFormat?: string;
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
  /**
   * `metadata` (Etapa 15D.3): el StorageFile.metadata persistido del
   * archivo, si el caller lo tiene disponible — sólo lo usa Cloudinary hoy
   * (resource_type/delivery type reales); local/Google Drive lo ignoran.
   */
  delete(storageKey: string, metadata?: unknown): Promise<void>;
  getPublicUrl(storageKey: string, metadata?: unknown): string | undefined;
  getFilePath(storageKey: string): string | undefined;
  download?(storageKey: string, metadata?: unknown): Promise<StorageDownloadResult>;
}

/**
 * Referencia mínima a un archivo ya existente: el provider con el que
 * realmente se subió (StorageFile.storageProvider persistido), no el
 * provider global activo hoy. Ver docs/decisions/STORAGE_PROVIDER_REGISTRY_15D1.md.
 * `metadata` (Etapa 15D.3): StorageFile.metadata persistido — opcional para
 * no romper callers que sólo tenían provider/storageKey antes de esta etapa.
 */
export interface StorageFileRef {
  storageProvider: PersistedStorageProvider;
  storageKey: string;
  metadata?: unknown;
}
