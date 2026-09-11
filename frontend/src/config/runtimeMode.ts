import type { Role } from "../types";

export const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

type DemoEnvironment = Pick<
  ImportMetaEnv,
  | "VITE_DEMO_MODE"
  | "VITE_DEMO_ADMIN_EMAIL"
  | "VITE_DEMO_ADMIN_PASSWORD"
  | "VITE_DEMO_SUPERVISOR_EMAIL"
  | "VITE_DEMO_SUPERVISOR_PASSWORD"
    | "VITE_DEMO_CARGA_EMAIL"
    | "VITE_DEMO_CARGA_PASSWORD"
>;

export type DemoLoginProfile = {
  role: Role;
  email: string;
  password: string;
};

export function resolveDemoLoginProfiles(env: Partial<DemoEnvironment>): DemoLoginProfile[] {
  if (env.VITE_DEMO_MODE !== "true") return [];

  const profiles: Array<DemoLoginProfile | undefined> = [
    env.VITE_DEMO_ADMIN_EMAIL && env.VITE_DEMO_ADMIN_PASSWORD
      ? {
          role: "Nivel 1 - RRHH",
          email: env.VITE_DEMO_ADMIN_EMAIL,
          password: env.VITE_DEMO_ADMIN_PASSWORD,
        }
      : undefined,
    env.VITE_DEMO_SUPERVISOR_EMAIL && env.VITE_DEMO_SUPERVISOR_PASSWORD
      ? {
          role: "Nivel 2 - Supervisión / Gestión",
          email: env.VITE_DEMO_SUPERVISOR_EMAIL,
          password: env.VITE_DEMO_SUPERVISOR_PASSWORD,
        }
      : undefined,
    env.VITE_DEMO_CARGA_EMAIL && env.VITE_DEMO_CARGA_PASSWORD
      ? {
          role: "Nivel 3 - Administrativo de Carga Horaria",
          email: env.VITE_DEMO_CARGA_EMAIL,
          password: env.VITE_DEMO_CARGA_PASSWORD,
        }
      : undefined,
  ];

  return profiles.filter((profile): profile is DemoLoginProfile => Boolean(profile));
}

export const demoLoginProfiles = resolveDemoLoginProfiles(import.meta.env);
