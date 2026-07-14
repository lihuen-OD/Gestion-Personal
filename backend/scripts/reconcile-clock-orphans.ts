import { env } from "../src/config/env";
import { prisma } from "../src/shared/prisma/client";
import { storageService } from "../src/shared/storage/storage.service";

async function main() {
  if (env.APP_ENV !== "staging") throw new Error(`Refusing orphan reconciliation in APP_ENV=${env.APP_ENV}`);
  const apply = process.argv.includes("--apply");
  const files = await prisma.storageFile.findMany({
    where: {
      module: "FICHADAS",
      status: "ACTIVE",
      uploadedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
      attendancePunchPhotoLinks: { none: {} },
      attendancePunchThumbnailLinks: { none: {} },
    },
    select: {
      id: true,
      fileName: true,
      storageProvider: true,
      sizeBytes: true,
      uploadedAt: true,
      employeeId: true,
      entityId: true,
      isThumbnail: true,
      metadata: true,
    },
    orderBy: { uploadedAt: "asc" },
  });

  console.log(JSON.stringify({ appEnv: env.APP_ENV, mode: apply ? "apply" : "dry-run", count: files.length, files }, null, 2));
  if (!apply) return;

  const failures: Array<{ id: string; error: string }> = [];
  for (const file of files) {
    try {
      await storageService.deleteManaged(file.id);
    } catch (error) {
      failures.push({ id: file.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const remaining = await prisma.storageFile.count({
    where: { id: { in: files.map((file) => file.id) }, status: "ACTIVE" },
  });
  console.log(JSON.stringify({ reconciled: files.length - failures.length, failures, remaining }));
  if (failures.length || remaining) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
