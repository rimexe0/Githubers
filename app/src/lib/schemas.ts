import { z } from "zod";

export const projectSchema = z.object({
  ownerType: z.enum(["org", "user"]),
  ownerLogin: z.string().min(1),
  projectNumber: z.coerce.number().int().positive(),
  title: z.string().optional().default(""),
  enabled: z.boolean().optional().default(true),
  repositories: z
    .array(
      z.object({
        ownerLogin: z.string().min(1),
        repoName: z.string().min(1),
        enabled: z.boolean().optional().default(true),
      }),
    )
    .optional()
    .default([]),
});

export const settingsSchema = z.object({
  githubToken: z.string().optional().default(""),
  pollIntervalMinutes: z.coerce.number().int().positive().default(60),
  summaryProviderOrder: z.string().default("lmstudio,codex,opencode,none"),
  summaryStyle: z.string().default("Concise situation summary with what changed, blockers, risks, and next actions."),
  summaryCron: z.string().default("0 8 * * *"),
  commentPollLimit: z.coerce.number().int().min(1).max(100).default(50),
  lmStudioBaseUrl: z.string().default("http://host.docker.internal:1234/v1"),
  lmStudioModel: z.string().default("local-model"),
  lmStudioTemperature: z.coerce.number().min(0).max(2).default(0.2),
  lmStudioMaxTokens: z.coerce.number().int().positive().default(2000),
  codexCommand: z.string().default("codex exec"),
  opencodeCommand: z.string().default("opencode run"),
  smtpHost: z.string().optional().default(""),
  smtpPort: z.coerce.number().int().positive().default(587),
  smtpUser: z.string().optional().default(""),
  smtpPassword: z.string().optional().default(""),
  emailFrom: z.string().optional().default(""),
  emailTo: z.string().optional().default(""),
  telegramBotToken: z.string().optional().default(""),
  telegramChatId: z.string().optional().default(""),
  webhookSecret: z.string().optional().default(""),
  // AgentAutomator daemon bridge. The repo->path map and trigger columns are
  // stored as newline text (one "key=value" per line) to match the existing
  // flat settings form; automator.ts parses them into maps.
  automatorEnabled: z.boolean().optional().default(false),
  automatorBaseUrl: z.string().default("http://host.docker.internal:3001/api/v1"),
  automatorToken: z.string().optional().default(""),
  automatorRepoPaths: z.string().optional().default(""), // "owner/repo=/local/clone/path" per line
  automatorTriggers: z.string().optional().default(""), // "Column name=supervised|full_auto" per line
});

export type AppSettings = z.infer<typeof settingsSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;

export const defaultSettings: AppSettings = settingsSchema.parse({});
