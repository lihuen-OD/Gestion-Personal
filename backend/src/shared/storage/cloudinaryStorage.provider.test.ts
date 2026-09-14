import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { cloudinaryStorageProvider } from "./cloudinaryStorage.provider";

/**
 * Etapa 15D.3 (docs/decisions/CLOUDINARY_SECURE_DELIVERY_15D3.md): prueba la
 * implementación REAL del provider — sólo se mockea `global.fetch`, sin red
 * real y sin credenciales reales (`CLOUDINARY_API_SECRET` acá es un string
 * inventado para el test, nunca un secreto real).
 */
type MutableEnv = {
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  CLOUDINARY_FOLDER?: string;
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function bufferResponse(buffer: Buffer, init: { ok?: boolean; status?: number; contentType?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? init.contentType || null : null) },
    arrayBuffer: async () => buffer,
  } as unknown as Response;
}

describe("cloudinaryStorageProvider — delivery seguro (Etapa 15D.3)", () => {
  const original: MutableEnv = {
    CLOUDINARY_CLOUD_NAME: env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: env.CLOUDINARY_API_SECRET,
    CLOUDINARY_FOLDER: env.CLOUDINARY_FOLDER,
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (env as MutableEnv).CLOUDINARY_CLOUD_NAME = "demo-cloud";
    (env as MutableEnv).CLOUDINARY_API_KEY = "fake-api-key";
    (env as MutableEnv).CLOUDINARY_API_SECRET = "fake-api-secret-not-real";
    (env as MutableEnv).CLOUDINARY_FOLDER = "gestion-personal-test";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    (env as MutableEnv).CLOUDINARY_CLOUD_NAME = original.CLOUDINARY_CLOUD_NAME;
    (env as MutableEnv).CLOUDINARY_API_KEY = original.CLOUDINARY_API_KEY;
    (env as MutableEnv).CLOUDINARY_API_SECRET = original.CLOUDINARY_API_SECRET;
    (env as MutableEnv).CLOUDINARY_FOLDER = original.CLOUDINARY_FOLDER;
    vi.unstubAllGlobals();
  });

  describe("upload", () => {
    it("sube con type=authenticated y persiste resource_type/type/asset_id/version/format reales devueltos por Cloudinary", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          public_id: "1234-contrato",
          secure_url: "https://res.cloudinary.com/demo-cloud/image/authenticated/s--x--/v1/gestion-personal-test/1234-contrato.pdf",
          resource_type: "image",
          type: "authenticated",
          asset_id: "asset-abc",
          version: 1700000000,
          format: "pdf",
          bytes: 1024,
        }),
      );

      const result = await cloudinaryStorageProvider.upload({
        buffer: Buffer.from("contenido-pdf"),
        fileName: "contrato.pdf",
        mimeType: "application/pdf",
      });

      expect(result).toMatchObject({
        provider: "cloudinary",
        storageKey: "1234-contrato",
        cloudinaryResourceType: "image",
        cloudinaryDeliveryType: "authenticated",
        cloudinaryAssetId: "asset-abc",
        cloudinaryVersion: "1700000000",
        cloudinaryFormat: "pdf",
        sizeBytes: 1024,
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.cloudinary.com/v1_1/demo-cloud/auto/upload");
      const form = init.body as FormData;
      expect(form.get("type")).toBe("authenticated");
    });

    it("upload falla con un error claro si Cloudinary responde error", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: { message: "Invalid signature" } }, { ok: false, status: 401 }));

      await expect(
        cloudinaryStorageProvider.upload({ buffer: Buffer.from("x"), fileName: "a.pdf", mimeType: "application/pdf" }),
      ).rejects.toMatchObject({ code: "STORAGE_CLOUDINARY_UPLOAD_FAILED" });
    });
  });

  describe("getPublicUrl", () => {
    it("nunca devuelve una URL pública permanente — ni para un archivo nuevo ni para uno legacy sin metadata", () => {
      expect(cloudinaryStorageProvider.getPublicUrl("cualquier-key")).toBeUndefined();
      expect(cloudinaryStorageProvider.getPublicUrl("cualquier-key", { cloudinaryResourceType: "image", cloudinaryDeliveryType: "authenticated" })).toBeUndefined();
    });
  });

  describe("download", () => {
    it("un archivo nuevo (metadata con delivery authenticated) descarga por la URL de descarga firmada del Upload API, nunca por la URL pública directa", async () => {
      fetchMock.mockResolvedValue(bufferResponse(Buffer.from("bytes-pdf"), { contentType: "application/pdf" }));

      const result = await cloudinaryStorageProvider.download!("1234-contrato", {
        cloudinaryResourceType: "image",
        cloudinaryDeliveryType: "authenticated",
      });

      expect(result).toEqual({ buffer: Buffer.from("bytes-pdf"), mimeType: "application/pdf" });
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toMatch(/^https:\/\/api\.cloudinary\.com\/v1_1\/demo-cloud\/image\/download\?/);
      expect(url).toContain("type=authenticated");
      expect(url).toContain("public_id=1234-contrato");
      expect(url).not.toContain("res.cloudinary.com");
    });

    it("un archivo legacy sin metadata descarga server-side por la URL pública previa a 15D.3 — nunca se expone esa URL al cliente, sólo la usa este fetch interno", async () => {
      fetchMock.mockResolvedValue(bufferResponse(Buffer.from("bytes-legacy")));

      const result = await cloudinaryStorageProvider.download!("legacy-key");

      expect(result.buffer).toEqual(Buffer.from("bytes-legacy"));
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe("https://res.cloudinary.com/demo-cloud/raw/upload/legacy-key");
    });

    it("propaga un error claro si Cloudinary no puede entregar el archivo", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 404 }));

      await expect(cloudinaryStorageProvider.download!("nope")).rejects.toMatchObject({
        code: "STORAGE_CLOUDINARY_DOWNLOAD_FAILED",
      });
    });
  });

  describe("delete", () => {
    it("usa el resource_type y el delivery type persistidos — no hardcodea image/destroy para un recurso raw", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ result: "ok" }));

      await cloudinaryStorageProvider.delete("planilla-key", { cloudinaryResourceType: "raw", cloudinaryDeliveryType: "authenticated" });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.cloudinary.com/v1_1/demo-cloud/raw/destroy");
      const form = init.body as FormData;
      expect(form.get("type")).toBe("authenticated");
      expect(form.get("public_id")).toBe("planilla-key");
    });

    it("un archivo legacy sin metadata borra por image/destroy — mismo comportamiento que antes de 15D.3", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ result: "ok" }));

      await cloudinaryStorageProvider.delete("legacy-key");

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe("https://api.cloudinary.com/v1_1/demo-cloud/image/destroy");
    });

    it("es idempotente: result=not found no lanza error", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ result: "not found" }, { ok: false, status: 404 }));

      await expect(cloudinaryStorageProvider.delete("ya-no-existe", { cloudinaryResourceType: "raw" })).resolves.toBeUndefined();
    });

    it("un error real de Cloudinary sí se propaga como error claro", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: { message: "boom" } }, { ok: false, status: 500 }));

      await expect(cloudinaryStorageProvider.delete("clave", { cloudinaryResourceType: "raw" })).rejects.toMatchObject({
        code: "STORAGE_CLOUDINARY_DELETE_FAILED",
      });
    });
  });
});
