"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Settings } from "./types";
import { api } from "./utils";

export function SettingsForm({ settings, setSettings, refresh, setMessage }: { settings: Settings; setSettings: (settings: Settings) => void; refresh: () => Promise<void>; setMessage: (message: string) => void }) {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });
  const save = async () => {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
    await refresh();
    setMessage("Settings saved");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Settings</h2>
        <Button type="button" size="sm" onClick={save}>Save settings</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold text-[var(--ctp-lavender)]">GitHub and scheduling</h3>
          <Field label="GitHub token" type="password" value={settings.githubToken} onChange={(value) => update("githubToken", value)} />
          <Field label="Poll interval minutes" value={String(settings.pollIntervalMinutes)} onChange={(value) => update("pollIntervalMinutes", Number(value))} />
          <Field label="Comments per issue/PR poll" value={String(settings.commentPollLimit)} onChange={(value) => update("commentPollLimit", Number(value))} />
          <Field label="Daily summary cron" value={settings.summaryCron} onChange={(value) => update("summaryCron", value)} />
          <Field label="Webhook secret" type="password" value={settings.webhookSecret} onChange={(value) => update("webhookSecret", value)} />
          <h3 className="pt-2 text-xs font-semibold text-[var(--ctp-lavender)]">Summarizers</h3>
          <Field label="Provider order" value={settings.summaryProviderOrder} onChange={(value) => update("summaryProviderOrder", value)} />
          <Field label="LM Studio base URL" value={settings.lmStudioBaseUrl} onChange={(value) => update("lmStudioBaseUrl", value)} />
          <Field label="LM Studio model" value={settings.lmStudioModel} onChange={(value) => update("lmStudioModel", value)} />
          <Field label="Codex command" value={settings.codexCommand} onChange={(value) => update("codexCommand", value)} />
          <Field label="OpenCode command" value={settings.opencodeCommand} onChange={(value) => update("opencodeCommand", value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => api("/api/health/github", { method: "POST" }).then(() => setMessage("GitHub connection OK")).catch((error) => setMessage(error.message))}>Test GitHub</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => api("/api/health/lmstudio", { method: "POST" }).then(() => setMessage("LM Studio connection OK")).catch((error) => setMessage(error.message))}>Test LM Studio</Button>
          </div>
        </div>
        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold text-[var(--ctp-lavender)]">Summary style</h3>
          <Label className="sr-only" htmlFor="summary-style">Summary style</Label>
          <Textarea id="summary-style" className="min-h-24" value={settings.summaryStyle} onChange={(event) => update("summaryStyle", event.target.value)} />
          <h3 className="pt-2 text-xs font-semibold text-[var(--ctp-lavender)]">Email</h3>
          <Field label="SMTP host" value={settings.smtpHost} onChange={(value) => update("smtpHost", value)} />
          <Field label="SMTP port" value={String(settings.smtpPort)} onChange={(value) => update("smtpPort", Number(value))} />
          <Field label="SMTP user" value={settings.smtpUser} onChange={(value) => update("smtpUser", value)} />
          <Field label="SMTP password" type="password" value={settings.smtpPassword} onChange={(value) => update("smtpPassword", value)} />
          <Field label="Email from" value={settings.emailFrom} onChange={(value) => update("emailFrom", value)} />
          <Field label="Email to" value={settings.emailTo} onChange={(value) => update("emailTo", value)} />
          <Button type="button" variant="secondary" size="sm" onClick={() => api("/api/notifications/test-email", { method: "POST" }).then(() => setMessage("Test email sent")).catch((error) => setMessage(error.message))}>Test email</Button>
          <h3 className="pt-2 text-xs font-semibold text-[var(--ctp-lavender)]">Telegram</h3>
          <Field label="Bot token" type="password" value={settings.telegramBotToken} onChange={(value) => update("telegramBotToken", value)} />
          <Field label="Chat ID" value={settings.telegramChatId} onChange={(value) => update("telegramChatId", value)} />
          <Button type="button" variant="secondary" size="sm" onClick={() => api("/api/notifications/test-telegram", { method: "POST" }).then(() => setMessage("Test Telegram sent")).catch((error) => setMessage(error.message))}>Test Telegram</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
