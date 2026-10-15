import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { AppError } from "../errors/AppError";
import { neonObjectStorageProvider } from "./neonObjectStorage.provider";

const original = {
  endpoint: env.NEON_OBJECT_STORAGE_ENDPOINT,
  bucket: env.NEON_OBJECT_STORAGE_BUCKET,
  access: env.NEON_OBJECT_STORAGE_ACCESS_KEY_ID,
  secret: env.NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY,
  timeout: env.NEON_OBJECT_STORAGE_TIMEOUT_MS,
};

describe("neonObjectStorageProvider", () => {
  beforeEach(() => {
    env.NEON_OBJECT_STORAGE_ENDPOINT = "https://storage.example.test";
    env.NEON_OBJECT_STORAGE_BUCKET = "private-test";
    env.NEON_OBJECT_STORAGE_ACCESS_KEY_ID = "access-id";
    env.NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY = "secret-value";
    env.NEON_OBJECT_STORAGE_TIMEOUT_MS = 1000;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.NEON_OBJECT_STORAGE_ENDPOINT = original.endpoint;
    env.NEON_OBJECT_STORAGE_BUCKET = original.bucket;
    env.NEON_OBJECT_STORAGE_ACCESS_KEY_ID = original.access;
    env.NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY = original.secret;
    env.NEON_OBJECT_STORAGE_TIMEOUT_MS = original.timeout;
  });

  it("sube con key determinista, metadata, checksum SigV4 y sin URL pública", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200, headers: { etag: '"abc"' } }));
    const input = { buffer: Buffer.from("image"), mimeType: "image/jpeg", fileName: "original.jpg", folderSegments: ["attendance", "2026", "10", "device", "request"], metadata: { checksum: "sha256" } };
    await expect(neonObjectStorageProvider.upload(input)).resolves.toEqual(expect.objectContaining({ provider: "neon_object_storage", storageKey: "attendance/2026/10/device/request/original.jpg", sizeBytes: 5, etag: '"abc"', checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://storage.example.test/private-test/attendance/2026/10/device/request/original.jpg");
    expect(init?.method).toBe("PUT");
    const headers = init?.headers as Headers;
    expect(headers.get("x-amz-meta-checksum")).toBe("sha256");
    expect(headers.get("x-amz-meta-sha256")).toMatch(/^[a-f0-9]{64}$/);
    expect(headers.get("authorization")).toContain("Credential=access-id/");
    expect(JSON.stringify({ url: String(url), method: init?.method })).not.toContain("secret-value");
    expect(neonObjectStorageProvider.getPublicUrl("x")).toBeUndefined();
  });

  it("sobrescribe idempotentemente la misma key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const input = { buffer: Buffer.from("same"), mimeType: "image/jpeg", fileName: "original.jpg", folderSegments: ["attendance", "request"] };
    const [one, two] = await Promise.all([neonObjectStorageProvider.upload(input), neonObjectStorageProvider.upload(input)]);
    expect(one.storageKey).toBe(two.storageKey);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([expect.stringContaining("attendance/request/original.jpg"), expect.stringContaining("attendance/request/original.jpg")]);
  });

  it("descarga, consulta existencia y borra", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(Buffer.from("photo"), { status: 200, headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(neonObjectStorageProvider.download!("a.jpg")).resolves.toMatchObject({ buffer: Buffer.from("photo"), mimeType: "image/jpeg" });
    await expect(neonObjectStorageProvider.exists!("a.jpg")).resolves.toBe(true);
    await expect(neonObjectStorageProvider.delete("a.jpg")).resolves.toBeUndefined();
    await expect(neonObjectStorageProvider.exists!("missing.jpg")).resolves.toBe(false);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "HEAD", "DELETE", "HEAD"]);
  });

  it.each([[403, "STORAGE_NEON_AUTH_FAILED"], [404, "STORAGE_NEON_OBJECT_NOT_FOUND"]])("normaliza HTTP %s", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
    await expect(neonObjectStorageProvider.download!("x")).rejects.toMatchObject({ code });
  });

  it("normaliza timeout sin exponer secretos", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const error = await neonObjectStorageProvider.download!("x").catch((caught) => caught as AppError);
    expect(error).toMatchObject({ code: "STORAGE_NEON_TIMEOUT", statusCode: 504 });
    expect(JSON.stringify(error)).not.toContain("secret-value");
  });
});
