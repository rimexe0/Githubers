import { env } from "@/lib/env";
import { runSummary } from "@/server/summarizers";
import { runSync } from "@/server/sync";

const globalForScheduler = globalThis as unknown as { githubersSchedulerStarted?: boolean };

function scheduleDailySummary() {
  const [minuteRaw, hourRaw] = env.summaryCron.split(" ");
  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return;

  setInterval(() => {
    const now = new Date();
    if (now.getHours() === hour && now.getMinutes() === minute) {
      runSummary("scheduled").catch((error) => console.error("Scheduled summary failed", error));
    }
  }, 60 * 1000);
}

export function startScheduler() {
  if (!env.schedulerEnabled || globalForScheduler.githubersSchedulerStarted) return;
  globalForScheduler.githubersSchedulerStarted = true;

  setInterval(
    () => {
      runSync("scheduled").catch((error) => console.error("Scheduled sync failed", error));
    },
    Math.max(1, env.pollIntervalMinutes) * 60 * 1000,
  );

  scheduleDailySummary();
}
