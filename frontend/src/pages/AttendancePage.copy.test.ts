import { describe, expect, it } from "vitest";
// Etapa 8R: bug real detectado en la auditoría de UI/UX — esta pantalla
// usaba <EmptyState text="Cargando..."> para los 4 estados de carga
// (jornadas abiertas/cerradas, problemas de fichada, evidencia fotográfica),
// así que un usuario podía ver "Sin resultados" mientras todavía cargaba.
// Sin jsdom/RTL, se lee el código fuente real (?raw) para confirmar que
// ningún <EmptyState> sigue usándose para un texto de carga.
import source from "./AttendancePage.tsx?raw";

describe("AttendancePage — loading real, no EmptyState como loading (Etapa 8R)", () => {
  it("ningún <EmptyState> tiene un texto de 'Cargando...' (ese es un estado de loading, no de vacío)", () => {
    expect(source).not.toMatch(/<EmptyState[^>]*text="[^"]*[Cc]argando/);
  });

  it("los 4 estados de carga usan LoadingState", () => {
    expect(source).toContain('<LoadingState variant="table" columns={12} />');
    expect(source).toContain('<LoadingState variant="table" columns={10} />');
    expect(source).toContain('<LoadingState variant="table" columns={6} rows={4} />');
    expect(source).toContain('<LoadingState text="Cargando evidencia fotográfica..." />');
  });

  it("los EmptyState que quedan son de resultados reales, no de carga", () => {
    expect(source).toContain('<EmptyState text={emptyText} icon={Clock3} />');
    expect(source).toContain("No hay problemas de fichada para los filtros seleccionados.");
  });
});
