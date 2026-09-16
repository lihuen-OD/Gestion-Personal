// Etapa 15L.4 §15/§16: comparación mínima entre un batch y el inmediato
// anterior — sólo conteos (agregadas/eliminadas/modificadas), sin diff celda
// por celda (fuera de alcance de esta etapa, ver decision doc §33).
export interface DiffableBatchItem {
  noveltyId: string | null;
  legajo: string;
  noveltyCode: string;
  applicationDate: string;
  costCenter: string;
  value1: string;
  validFrom: string;
  validTo: string;
}

export interface BatchDiffSummary {
  added: number;
  removed: number;
  modified: number;
}

function snapshotKey(item: DiffableBatchItem): string {
  return `${item.legajo}|${item.noveltyCode}|${item.applicationDate}`;
}

function hasChanged(previous: DiffableBatchItem, current: DiffableBatchItem): boolean {
  return (
    previous.costCenter !== current.costCenter ||
    previous.value1 !== current.value1 ||
    previous.applicationDate !== current.applicationDate ||
    previous.validFrom !== current.validFrom ||
    previous.validTo !== current.validTo
  );
}

// Etapa 15L.4 §15/§16: la key preferida es `noveltyId` (cuando ambos lados
// la tienen), con fallback a legajo+noveltyCode+applicationDate. Esto
// importa especialmente cuando una Novelty se borra y se recrea corregida
// (otro id): el item VIEJO, una vez que su FK se pone en null por el
// borrado (onDelete: SetNull), ya no tiene `noveltyId` — cae al fallback
// por snapshot y sigue pudiendo emparejarse con el item nuevo si
// legajo/noveltyCode/applicationDate coinciden, mostrando la fila como
// "modificada" en vez de perderla como un removed+added sin relación.
export function diffBatchItems(previousItems: readonly DiffableBatchItem[] | null, currentItems: readonly DiffableBatchItem[]): BatchDiffSummary | null {
  if (!previousItems) return null;

  const previousById = new Map<string, DiffableBatchItem>();
  const previousBySnapshot = new Map<string, DiffableBatchItem>();
  for (const item of previousItems) {
    if (item.noveltyId) previousById.set(item.noveltyId, item);
    previousBySnapshot.set(snapshotKey(item), item);
  }

  const matchedPrevious = new Set<string>();
  let added = 0;
  let modified = 0;

  for (const item of currentItems) {
    const matchedById = item.noveltyId ? previousById.get(item.noveltyId) : undefined;
    const matched = matchedById ?? previousBySnapshot.get(snapshotKey(item));
    if (!matched) {
      added += 1;
      continue;
    }
    matchedPrevious.add(snapshotKey(matched));
    if (hasChanged(matched, item)) modified += 1;
  }

  let removed = 0;
  for (const item of previousItems) {
    if (!matchedPrevious.has(snapshotKey(item))) removed += 1;
  }

  return { added, removed, modified };
}
