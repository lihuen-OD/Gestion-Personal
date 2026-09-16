// Etapa 15L.3A (docs/decisions/FINNEGANS_EXPORT_NORMALIZED_15L3A.md): un
// NoveltyType todavía puede tener más de un FinnegansNoveltyLink (la
// relación sigue siendo 1:N, no se migra a 1:1 en esta etapa). El
// exportador nunca debe usar más de un vínculo por fila — este helper
// centraliza la misma regla de desempate que ya usa el frontend
// (findPrincipalLinkIndex, NoveltyTypeFields.tsx, Etapa 15L.2B): entre los
// vínculos ACTIVO recibidos, gana el de menor `priority`; empate estable
// por `code`. El caller ya filtra `status: "ACTIVO"` en la consulta a
// Prisma, así que acá no hay fallback a vínculos inactivos (a diferencia
// del frontend, que sí lo necesita para no perder de vista un vínculo único
// inactivo al editar el catálogo — el exportador no edita nada).
export interface FinnegansLinkLike {
  code: string;
  priority: number;
}

export function resolvePrincipalFinnegansLink<T extends FinnegansLinkLike>(activeLinks: readonly T[]): T | null {
  if (!activeLinks.length) return null;
  return activeLinks.reduce((best, link) => {
    if (link.priority !== best.priority) return link.priority < best.priority ? link : best;
    return link.code < best.code ? link : best;
  });
}
