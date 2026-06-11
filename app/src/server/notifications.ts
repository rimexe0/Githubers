import nodemailer from "nodemailer";
import { getSettings } from "@/server/settings";

export async function sendTestEmail() {
  const settings = await getSettings();
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPassword || !settings.emailTo) {
    throw new Error("SMTP host, user, password, and recipient are required");
  }

  const transport = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpPort === 465,
    auth: { user: settings.smtpUser, pass: settings.smtpPassword },
  });

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
