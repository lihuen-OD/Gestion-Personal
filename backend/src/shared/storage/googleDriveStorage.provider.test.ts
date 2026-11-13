import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provider de Google Drive contra un Drive simulado en memoria (fetch
 * mockeado): ubicación humana, identidad de carpeta por appProperties y
 * búsqueda de copias de archivo acotada a la raíz del entorno.
 */
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

const envMock = vi.hoisted(() => ({
  env: {
    GOOGLE_DRIVE_ENABLED: true,
    GOOGLE_DRIVE_ROOT_FOLDER_ID: "root-dev",
    GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL: "sa@example.iam.gserviceaccount.com",
    GOOGLE_DRIVE_PRIVATE_KEY: "",
  },
}));
vi.mock("../../config/env", () => envMock);

import {
  findGoogleDriveArchiveCopy,
  googleDriveArchiveAppProperties,
  googleDriveStorageProvider,
  resetGoogleDriveFolderCacheForTests,
} from "./googleDriveStorage.provider";

type FakeFile = { id: string; name: string; parent: string; folder: boolean; appProperties: Record<string, string>; trashed?: boolean };

let files: FakeFile[];
let nextId: number;
let requests: Array<{ method: string; url: string; body?: unknown }>;

/** Evalúa el subconjunto de la sintaxis `q` de Drive que usa el provider. */
function matches(file: FakeFile, q: string) {
  if (q.includes("trashed = false") && file.trashed) return false;
  if (q.includes("mimeType = 'application/vnd.google-apps.folder'") && !file.folder) return false;
  const parent = /'([^']+)' in parents/.exec(q)?.[1];
  if (parent && file.parent !== parent) return false;
  const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1];
  if (name !== undefined && file.name !== name.replace(/\\'/g, "'")) return false;
  for (const [, key, value] of q.matchAll(/appProperties has \{ key = '([^']+)' and value = '([^']*)' \}/g)) {
    if (file.appProperties[key!] !== value) return false;
  }
  return true;
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}) {
  const url = new URL(String(input));
  const method = init.method || "GET";
  if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "token", expires_in: 3600 });
  if (method === "GET" && url.pathname === "/drive/v3/files") {
    requests.push({ method, url: url.toString() });
    const q = url.searchParams.get("q") || "";
    return json({ files: files.filter((file) => matches(file, q)).map(({ id, name }) => ({ id, name })) });
  }
  if (method === "POST" && url.pathname === "/drive/v3/files") {
    const body = JSON.parse(String(init.body)) as { name: string; parents: string[]; appProperties?: Record<string, string> };
    requests.push({ method, url: url.toString(), body });
    const created = { id: `folder-${nextId++}`, name: body.name, parent: body.parents[0]!, folder: true, appProperties: body.appProperties || {} };
    files.push(created);
    return json({ id: created.id, name: created.name });
  }
  if (method === "PATCH" && url.pathname.startsWith("/drive/v3/files/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    const body = JSON.parse(String(init.body)) as { name?: string };
    requests.push({ method, url: url.toString(), body });
    const file = files.find((item) => item.id === id)!;
    if (body.name) file.name = body.name;
    return json({ id, name: file.name });
  }
  if (method === "POST" && url.pathname === "/upload/drive/v3/files") {
    const raw = Buffer.from(init.body as Buffer).toString("utf8");
    const metadata = JSON.parse(raw.slice(raw.indexOf("{"), raw.indexOf("}\r\n") + 1)) as { name: string; parents: string[]; appProperties: Record<string, string> };
    requests.push({ method, url: url.toString(), body: metadata });
    const created = { id: `file-${nextId++}`, name: metadata.name, parent: metadata.parents[0]!, folder: false, appProperties: metadata.appProperties };
    files.push(created);
    return json({ id: created.id, name: created.name, parents: [created.parent], size: "4" });
  }
  throw new Error(`Unexpected Drive request ${method} ${url}`);
}

function folderPath(id: string): string[] {
  const file = files.find((item) => item.id === id);
  if (!file) return [];
  return [...folderPath(file.parent), file.name];
}

beforeEach(() => {
  envMock.env.GOOGLE_DRIVE_PRIVATE_KEY = privateKey;
  envMock.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "root-dev";
  files = [];
  nextId = 1;
  requests = [];
  resetGoogleDriveFolderCacheForTests();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const buffer = Buffer.from("%PDF");

describe("googleDriveStorageProvider.upload — ubicación humana", () => {
  it("crea las carpetas con espacios, acentos y Ñ, y el archivo con el nombre portable", async () => {
    const result = await googleDriveStorageProvider.upload({
      buffer,
      mimeType: "application/pdf",
      fileName: "2026-11-13_DNI_Jose-Pena_a1b2c3.pdf",
      folderSegments: ["legajos", "employee-7", "documentos-personales"],
      driveFolders: [{ name: "Legajos" }, { name: "0007 - José Peña", appProperties: { employeeId: "employee-7" } }, { name: "Documentos personales" }],
    });

    const uploaded = files.find((file) => file.id === result.storageKey)!;
    expect(uploaded.name).toBe("2026-11-13_DNI_Jose-Pena_a1b2c3.pdf");
    expect(folderPath(uploaded.parent)).toEqual(["Legajos", "0007 - José Peña", "Documentos personales"]);
    expect(files.find((file) => file.name === "0007 - José Peña")!.appProperties).toEqual({ employeeId: "employee-7" });
    // La ubicación técnica no llega a Drive.
    expect(files.some((file) => file.name === "legajos" || file.name === "storage-sistema")).toBe(false);
  });

  it("sin driveFolders conserva el comportamiento anterior (folderSegments)", async () => {
    const result = await googleDriveStorageProvider.upload({ buffer, mimeType: "application/pdf", fileName: "a.pdf", folderSegments: ["otros", "x"] });

    expect(folderPath(files.find((file) => file.id === result.storageKey)!.parent)).toEqual(["otros", "x"]);
  });

  it("rechaza un segmento vacío o de navegación", async () => {
    await expect(googleDriveStorageProvider.upload({ buffer, mimeType: "application/pdf", fileName: "a.pdf", driveFolders: [{ name: ".." }] })).rejects.toMatchObject({ code: "STORAGE_INVALID_PATH" });
  });
});

describe("googleDriveStorageProvider.upload — carpeta del empleado identificada por employeeId", () => {
  const folders = (name: string) => [{ name: "Legajos" }, { name, appProperties: { employeeId: "employee-1" } }, { name: "Contratos" }];

  it("si cambian nombre o legajo reutiliza la misma carpeta y la renombra (sin duplicar)", async () => {
    const first = await googleDriveStorageProvider.upload({ buffer, mimeType: "application/pdf", fileName: "a.pdf", driveFolders: folders("0001 - Juan Perez") });
    // Otro proceso (o un reinicio): sin caché.
    resetGoogleDriveFolderCacheForTests();
    const second = await googleDriveStorageProvider.upload({ buffer, mimeType: "application/pdf", fileName: "b.pdf", driveFolders: folders("0100 - Juan Pérez") });

    const employeeFolders = files.filter((file) => file.folder && file.appProperties.employeeId === "employee-1");
    expect(employeeFolders).toHaveLength(1);
    expect(employeeFolders[0]!.name).toBe("0100 - Juan Pérez");
    expect(first.driveFolderId).toBe(second.driveFolderId);
    expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
  });

  it("con la carpeta en caché y el nombre cambiado en el mismo proceso, también renombra", async () => {
    await googleDriveStorageProvider.upload({ buffer, mimeType: "application/pdf", fileName: "a.pdf", driveFolders: folders("0001 - Juan Perez") });
    await googleDriveStorageProvider.upload({ buffer, mimeType: "application/pdf", fileName: "b.pdf", driveFolders: folders("0001 - Juan Carlos Perez") });

    const employeeFolders = files.filter((file) => file.folder && file.appProperties.employeeId === "employee-1");
    expect(employeeFolders.map((file) => file.name)).toEqual(["0001 - Juan Carlos Perez"]);
  });

  it("una carpeta con el mismo nombre visible pero de otro empleado no se reutiliza", async () => {
    await googleDriveStorageProvider.upload({ buffer, mimeType: "application/pdf", fileName: "a.pdf", driveFolders: [{ name: "Legajos" }, { name: "0001 - Juan Perez", appProperties: { employeeId: "employee-1" } }] });
    await googleDriveStorageProvider.upload({ buffer, mimeType: "application/pdf", fileName: "b.pdf", driveFolders: [{ name: "Legajos" }, { name: "0001 - Juan Perez", appProperties: { employeeId: "employee-2" } }] });

    expect(files.filter((file) => file.folder && file.name === "0001 - Juan Perez")).toHaveLength(2);
  });

  it("subidas concurrentes del mismo empleado en el proceso crean una sola carpeta", async () => {
    await Promise.all([
      googleDriveStorageProvider.upload({ buffer, mimeType: "application/pdf", fileName: "a.pdf", driveFolders: folders("0001 - Juan Perez") }),
      googleDriveStorageProvider.upload({ buffer, mimeType: "application/pdf", fileName: "b.pdf", driveFolders: folders("0001 - Juan Perez") }),
    ]);

    expect(files.filter((file) => file.folder && file.appProperties.employeeId === "employee-1")).toHaveLength(1);
  });
});

describe("findGoogleDriveArchiveCopy — acotada por archiveRootId", () => {
  it("marca la copia con la raíz del entorno y sólo la encuentra con esa misma raíz", async () => {
    await googleDriveStorageProvider.upload({
      buffer,
      mimeType: "image/jpeg",
      fileName: "2026-11-13_08-02_INGRESO_b72d61.jpg",
      driveFolders: [{ name: "Fichadas" }],
      metadata: googleDriveArchiveAppProperties("sf-1", "abc"),
    });

    expect(await findGoogleDriveArchiveCopy("sf-1")).toMatchObject({ name: "2026-11-13_08-02_INGRESO_b72d61.jpg" });

    // Otro entorno (u otra raíz anterior) con la misma service account.
    envMock.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "root-prod";
    expect(await findGoogleDriveArchiveCopy("sf-1")).toBeNull();
  });

  it("una copia vieja sin archiveRootId (layout anterior) no se reutiliza", async () => {
    files.push({ id: "legacy-copy", name: "req.jpg", parent: "old-root", folder: false, appProperties: { sourceStorageFileId: "sf-1", checksum: "abc" } });

    expect(await findGoogleDriveArchiveCopy("sf-1")).toBeNull();
  });

  it("una copia en la papelera no se reutiliza", async () => {
    files.push({ id: "trashed-copy", name: "x.jpg", parent: "root-dev", folder: false, appProperties: { sourceStorageFileId: "sf-1", archiveRootId: "root-dev" }, trashed: true });

    expect(await findGoogleDriveArchiveCopy("sf-1")).toBeNull();
  });

  it("googleDriveArchiveAppProperties incluye origen, checksum y raíz", () => {
    expect(googleDriveArchiveAppProperties("sf-9", null)).toEqual({ sourceStorageFileId: "sf-9", checksum: "", archiveRootId: "root-dev" });
  });
});
