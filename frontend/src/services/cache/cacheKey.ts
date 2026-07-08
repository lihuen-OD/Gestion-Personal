const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  if (globalThis.crypto?.subtle) {
    return toHex(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value)));
  }

  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return `fallback-${Math.abs(hash).toString(16)}`;
}

function currentUserId() {
  try {
    const user = JSON.parse(sessionStorage.getItem("losod_user") || "null") as { id?: string } | null;
    return user?.id || "anonymous";
  } catch {
    return "anonymous";
  }
}

export async function currentUserHash() {
  return sha256(currentUserId());
}

export async function buildCacheKey(input: { family: string; schemaVersion: number; requestKey: string }) {
  const [userHash, requestHash] = await Promise.all([currentUserHash(), sha256(input.requestKey)]);
  return `cache:v${input.schemaVersion}:${userHash}:${input.family}:${requestHash}`;
}

