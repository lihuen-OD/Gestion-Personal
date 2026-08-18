import { describe, expect, it } from "vitest";
import { validateStorageFile } from "./storageValidation";

function buffer(sizeInBytes: number) {
  return Buffer.alloc(sizeInBytes, 1);
}

describe("validateStorageFile", () => {
  it("acepta un PDF valido de tamano razonable", () => {
    expect(() =>
      validateStorageFile({ buffer: buffer(1024), fileName: "contrato.pdf", mimeType: "application/pdf" }),
    ).not.toThrow();
  });

  it("rechaza un archivo vacio", () => {
    expect(() =>
      validateStorageFile({ buffer: buffer(0), fileName: "vacio.pdf", mimeType: "application/pdf" }),
    ).toThrow(expect.objectContaining({ code: "STORAGE_FILE_EMPTY" }));
  });

  it("rechaza extensiones bloqueadas aunque el mime type declarado sea uno permitido", () => {
    expect(() =>
      validateStorageFile({ buffer: buffer(1024), fileName: "script.exe", mimeType: "application/pdf" }),
    ).toThrow(expect.objectContaining({ code: "STORAGE_FILE_EXTENSION_BLOCKED" }));
  });

  it("rechaza un mime type que no esta en la lista permitida", () => {
    expect(() =>
      validateStorageFile({ buffer: buffer(1024), fileName: "video.mp4", mimeType: "video/mp4" }),
    ).toThrow(expect.objectContaining({ code: "STORAGE_FILE_MIME_BLOCKED" }));
  });

  it("rechaza un archivo general que supera el tamano maximo configurado", () => {
    const oversized = 11 * 1024 * 1024;
    expect(() =>
      validateStorageFile({ buffer: buffer(oversized), fileName: "grande.pdf", mimeType: "application/pdf" }),
    ).toThrow(expect.objectContaining({ code: "STORAGE_FILE_TOO_LARGE" }));
  });

  it("aplica el limite de tamano mas chico y la lista de mime mas estricta para fotos de fichada", () => {
    expect(() =>
      validateStorageFile({
        buffer: buffer(1024),
        fileName: "foto.pdf",
        mimeType: "application/pdf",
        purpose: "punch-photo",
      }),
    ).toThrow(expect.objectContaining({ code: "STORAGE_FILE_MIME_BLOCKED" }));

    const overPunchLimit = 3 * 1024 * 1024;
    expect(() =>
      validateStorageFile({
        buffer: buffer(overPunchLimit),
        fileName: "foto.jpg",
        mimeType: "image/jpeg",
        purpose: "punch-photo",
      }),
    ).toThrow(expect.objectContaining({ code: "STORAGE_FILE_TOO_LARGE" }));

    expect(() =>
      validateStorageFile({
        buffer: buffer(1024),
        fileName: "foto.jpg",
        mimeType: "image/jpeg",
        purpose: "punch-photo",
      }),
    ).not.toThrow();
  });
});
