import { query } from "@/db/client";
import { defaultSettings, settingsSchema, type AppSettings } from "@/lib/schemas";

export async function getSettings(): Promise<AppSettings> {
  const result = await query<{ key: string; value: unknown }>("SELECT key, value FROM settings");
  const merged = { ...defaultSettings } as Record<string, unknown>;

  for (const row of result.rows) {
    merged[row.key] = row.value;
  }

  return settingsSchema.parse(merged);
}

export async function saveSettings(settings: AppSettings) {
  const parsed = settingsSchema.parse(settings);
  const entries = Object.entries(parsed);
  for (const [key, value] of entries) {
    await query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
  return parsed;
}
