/**
 * Fixture de la especificación REAL de Planta (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25),
 * como snapshot del núcleo de rotaciones (rotationPlan.ts). Sólo para tests;
 * reutilizable en R4.3–R4.9. Ciclo de 2 semanas, ancla lunes 02/11/2026 =
 * Semana A (índice 0); Semana B = índice 1.
 *
 * | Equipo                 | Semana A                                  | Semana B                          |
 * |------------------------|-------------------------------------------|-----------------------------------|
 * | Roberto + Ariel        | L–J 07–17; V–D 07–19                      | L–J 17–03; V–D descanso           |
 * | Carlos + Walter        | L–J 17–03; V–D descanso                   | L–J 07–17; V–D 07–19              |
 * | Juanchi                | L desc.; M–V 03–11; S–D desc.             | L 07–15; M–J 03–11; V–S–D 19–07   |
 * | José                   | L–J 07–15; V 07–11 + 19–07; S–D 19–07     | L desc.; M–V 07–15; S–D desc.     |
 * | Johanna                | L–V 07–15; S–D descanso                   | L–D 07–15                         |
 * Juanjo NO está en la rotación (turno fijo L–V 07–15; S/D sin obligación).
 */
import type { RotationConfiguration, RotationDaySnapshot, RotationSnapshot, RotationTemplateRef, RotationVersionSnapshot } from "./rotationPlan";

const template = (id: string, startTime: string, endTime: string): RotationTemplateRef => ({ id, code: id, startTime, endTime, crossesMidnight: endTime <= startTime, status: "ACTIVO" });

export const PLANTA_TEMPLATES = {
  T0717: template("PLANTA-07-17", "07:00", "17:00"),
  T0719: template("PLANTA-07-19", "07:00", "19:00"),
  T1703: template("PLANTA-17-03", "17:00", "03:00"),
  T0311: template("PLANTA-03-11", "03:00", "11:00"),
  T0715: template("PLANTA-07-15", "07:00", "15:00"),
  T1907: template("PLANTA-19-07", "19:00", "07:00"),
  T0711: template("PLANTA-07-11", "07:00", "11:00"),
} as const;

export const PLANTA_ANCHOR = "2026-11-02";
export const PLANTA_ROTATION_ID = "rot-planta";
export const PLANTA_VERSION_ID = "ver-planta-1";

export const PLANTA_CREWS = {
  ROBERTO_ARIEL: "crew-roberto-ariel",
  CARLOS_WALTER: "crew-carlos-walter",
  JUANCHI: "crew-juanchi",
  JOSE: "crew-jose",
  JOHANNA: "crew-johanna",
} as const;

export const PLANTA_EMPLOYEES = {
  ROBERTO: "emp-roberto",
  ARIEL: "emp-ariel",
  CARLOS: "emp-carlos",
  WALTER: "emp-walter",
  JUANCHI: "emp-juanchi",
  JOSE: "emp-jose",
  JOHANNA: "emp-johanna",
  JUANJO: "emp-juanjo",
} as const;

/** Semana del ciclo: lista lunes→domingo; cada día = descanso (vacío) o 1..N plantillas en orden. */
type WeekSpec = [RotationTemplateRef[], RotationTemplateRef[], RotationTemplateRef[], RotationTemplateRef[], RotationTemplateRef[], RotationTemplateRef[], RotationTemplateRef[]];
const REST: RotationTemplateRef[] = [];
const { T0717, T0719, T1703, T0311, T0715, T1907, T0711 } = PLANTA_TEMPLATES;

const PLANTA_GRID: Record<string, [WeekSpec, WeekSpec]> = {
  [PLANTA_CREWS.ROBERTO_ARIEL]: [
    [[T0717], [T0717], [T0717], [T0717], [T0719], [T0719], [T0719]],
    [[T1703], [T1703], [T1703], [T1703], REST, REST, REST],
  ],
  [PLANTA_CREWS.CARLOS_WALTER]: [
    [[T1703], [T1703], [T1703], [T1703], REST, REST, REST],
    [[T0717], [T0717], [T0717], [T0717], [T0719], [T0719], [T0719]],
  ],
  [PLANTA_CREWS.JUANCHI]: [
    [REST, [T0311], [T0311], [T0311], [T0311], REST, REST],
    [[T0715], [T0311], [T0311], [T0311], [T1907], [T1907], [T1907]],
  ],
  [PLANTA_CREWS.JOSE]: [
    [[T0715], [T0715], [T0715], [T0715], [T0711, T1907], [T1907], [T1907]],
    [REST, [T0715], [T0715], [T0715], [T0715], REST, REST],
  ],
  [PLANTA_CREWS.JOHANNA]: [
    [[T0715], [T0715], [T0715], [T0715], [T0715], REST, REST],
    [[T0715], [T0715], [T0715], [T0715], [T0715], [T0715], [T0715]],
  ],
};

/** lunes→domingo (posición 0..6) a la convención 0 = domingo … 6 = sábado. */
const weekdayOfPosition = (position: number) => (position + 1) % 7;

export function plantaDays(): RotationDaySnapshot[] {
  const days: RotationDaySnapshot[] = [];
  for (const [crewId, weeks] of Object.entries(PLANTA_GRID)) {
    weeks.forEach((week, cycleWeekIndex) => {
      week.forEach((templates, position) => {
        const weekday = weekdayOfPosition(position);
        days.push({
          id: `day-${crewId}-${cycleWeekIndex}-${weekday}`,
          crewId,
          cycleWeekIndex,
          weekday,
          kind: templates.length ? "SHIFT" : "REST",
          blocks: templates.map((item, blockIndex) => ({ blockIndex, template: item })),
        });
      });
    });
  }
  return days;
}

export function plantaVersion(overrides: Partial<RotationVersionSnapshot> = {}): RotationVersionSnapshot {
  return { id: PLANTA_VERSION_ID, rotationId: PLANTA_ROTATION_ID, cycleLengthWeeks: 2, anchorWeekStart: PLANTA_ANCHOR, effectiveFrom: PLANTA_ANCHOR, effectiveTo: null, days: plantaDays(), ...overrides };
}

export function plantaRotation(overrides: Partial<RotationSnapshot> = {}): RotationSnapshot {
  return {
    id: PLANTA_ROTATION_ID,
    code: "PLANTA",
    status: "ACTIVO",
    crews: Object.entries(PLANTA_CREWS).map(([code, id]) => ({ id, code, status: "ACTIVO" as const })),
    versions: [plantaVersion()],
    ...overrides,
  };
}

const membership = (employeeId: string, crewId: string) => ({ employeeId, rotationId: PLANTA_ROTATION_ID, crewId, effectiveFrom: PLANTA_ANCHOR, effectiveTo: null });

/** Configuración completa de Planta: rotación + membresías vigentes desde el ancla (Juanjo no es miembro). */
export function plantaConfiguration(): RotationConfiguration {
  return {
    rotations: [plantaRotation()],
    memberships: [
      membership(PLANTA_EMPLOYEES.ROBERTO, PLANTA_CREWS.ROBERTO_ARIEL),
      membership(PLANTA_EMPLOYEES.ARIEL, PLANTA_CREWS.ROBERTO_ARIEL),
      membership(PLANTA_EMPLOYEES.CARLOS, PLANTA_CREWS.CARLOS_WALTER),
      membership(PLANTA_EMPLOYEES.WALTER, PLANTA_CREWS.CARLOS_WALTER),
      membership(PLANTA_EMPLOYEES.JUANCHI, PLANTA_CREWS.JUANCHI),
      membership(PLANTA_EMPLOYEES.JOSE, PLANTA_CREWS.JOSE),
      membership(PLANTA_EMPLOYEES.JOHANNA, PLANTA_CREWS.JOHANNA),
    ],
  };
}
