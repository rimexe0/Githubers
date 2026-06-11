export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://githubers:githubers@localhost:5432/githubers",
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  pollIntervalMinutes: Number(process.env.POLL_INTERVAL_MINUTES ?? "60"),
  summaryCron: process.env.SUMMARY_CRON ?? "0 8 * * *",
  schedulerEnabled: process.env.SCHEDULER_ENABLED !== "false",
};
