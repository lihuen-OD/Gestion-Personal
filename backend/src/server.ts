import { env } from "./config/env";
import { createApp } from "./app";
import { startClockPunchMaintenance } from "./modules/time-entries/clockPunchMaintenance";

const app = createApp();
startClockPunchMaintenance();

app.listen(env.PORT, () => {
  console.info(`Backend API listening on http://localhost:${env.PORT}${env.API_PREFIX}`);
});
