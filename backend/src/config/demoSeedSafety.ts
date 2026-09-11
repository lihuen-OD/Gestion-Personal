export type DemoSeedEnvironment = {
  APP_ENV?: string;
  NODE_ENV?: string;
  DEMO_SEED_PASSWORD?: string;
};

export function demoSeedPassword(env: DemoSeedEnvironment): string {
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (appEnv === "production" || nodeEnv === "production") {
    throw new Error("Refusing to run demo seed in production");
  }

  if (!env.DEMO_SEED_PASSWORD || env.DEMO_SEED_PASSWORD.length < 8) {
    throw new Error("DEMO_SEED_PASSWORD must contain at least 8 characters");
  }

  return env.DEMO_SEED_PASSWORD;
}
