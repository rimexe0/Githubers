import nodemailer from "nodemailer";
import { query } from "@/db/client";
import type { AppSettings } from "@/lib/schemas";
import { getSettings } from "@/server/settings";

type SummaryDelivery = {
  id: string;
  title: string;
  body: string;
  shortBody: string;
};

function createTransport(settings: AppSettings) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpPort === 465,
    auth: { user: settings.smtpUser, pass: settings.smtpPassword },
  });
}

export async function sendTestEmail() {
  const settings = await getSettings();
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPassword || !settings.emailTo) {
    throw new Error("SMTP host, user, password, and recipient are required");
  }

  const transport = createTransport(settings);

  await transport.sendMail({
    from: settings.emailFrom || settings.smtpUser,
    to: settings.emailTo,
    subject: "Githubers test email",
    text: "Githubers email notifications are configured.",
  });
}

export async function sendTestTelegram() {
  const settings = await getSettings();
  if (!settings.telegramBotToken || !settings.telegramChatId) {
    throw new Error("Telegram bot token and chat ID are required");
  }

  const response = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: settings.telegramChatId, text: "Githubers Telegram notifications are configured." }),
  });

  if (!response.ok) throw new Error(`Telegram failed: ${response.status} ${response.statusText}`);
}

export async function deliverSummaryNotifications(summary: SummaryDelivery) {
  const settings = await getSettings();
  await Promise.all([deliverEmailSummary(summary, settings), deliverTelegramSummary(summary, settings)]);
}

async function deliverEmailSummary(summary: SummaryDelivery, settings: AppSettings) {
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPassword || !settings.emailTo) return;

  try {
    const transport = createTransport(settings);
    await transport.sendMail({
      from: settings.emailFrom || settings.smtpUser,
      to: settings.emailTo,
      subject: summary.title,
      text: summary.body,
    });
    await recordDelivery(summary.id, "email", "success");
  } catch (error) {
    await recordDelivery(summary.id, "email", "failed", error);
  }
}

async function deliverTelegramSummary(summary: SummaryDelivery, settings: AppSettings) {
  if (!settings.telegramBotToken || !settings.telegramChatId) return;

  try {
    const response = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: settings.telegramChatId, text: summary.shortBody.slice(0, 3900) }),
    });
    if (!response.ok) throw new Error(`Telegram failed: ${response.status} ${response.statusText}`);
    await recordDelivery(summary.id, "telegram", "success");
  } catch (error) {
    await recordDelivery(summary.id, "telegram", "failed", error);
  }
}

async function recordDelivery(summaryId: string, channel: "email" | "telegram", status: "success" | "failed", error?: unknown) {
  await query(
    "INSERT INTO notification_deliveries (summary_id, channel, status, error) VALUES ($1, $2, $3, $4)",
    [summaryId, channel, status, error instanceof Error ? error.message : error ? String(error) : null],
  );
}
