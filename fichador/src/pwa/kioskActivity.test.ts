import { afterEach, describe, expect, it } from "vitest";
import { kioskActivity } from "./kioskActivity";

describe("kioskActivity — retenciones del modo mantenimiento", () => {
  afterEach(() => {
    kioskActivity.setBusy(false);
  });

  it("una retención mantiene el kiosco ocupado aunque el fichador se declare ocioso", () => {
    const release = kioskActivity.hold();
    kioskActivity.setBusy(false);
    expect(kioskActivity.isIdle()).toBe(false);
    release();
    expect(kioskActivity.isIdle()).toBe(true);
  });

  it("cada retención se libera por separado y liberar dos veces no afecta a otra", () => {
    const first = kioskActivity.hold();
    const second = kioskActivity.hold();
    first();
    first();
    expect(kioskActivity.isIdle()).toBe(false);
    second();
    expect(kioskActivity.isIdle()).toBe(true);
  });
});
