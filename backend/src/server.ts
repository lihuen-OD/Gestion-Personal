import { env } from "./config/env";
import { createApp } from "./app";
import { startAutomaticJobs } from "./automaticJobs";

const app = createApp();
startAutomaticJobs();

app.listen(env.PORT, () => {
  console.info(`Backend API listening on http://localhost:${env.PORT}${env.API_PREFIX}`);
});
