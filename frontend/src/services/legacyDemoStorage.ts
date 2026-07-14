const cleanupMarker = "losod_backend_storage_cleanup_v1";
const legacyPrefix = "losod_demo_";

export function cleanupLegacyDemoStorage(storage: Pick<Storage, "getItem" | "key" | "length" | "removeItem" | "setItem"> = localStorage) {
  if (storage.getItem(cleanupMarker) === "done") return 0;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => Boolean(key?.startsWith(legacyPrefix)),
  );
  keys.forEach((key) => storage.removeItem(key));
  storage.setItem(cleanupMarker, "done");
  return keys.length;
}
