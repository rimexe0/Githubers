export type Settings = {
  githubToken: string;
  pollIntervalMinutes: number;
  summaryProviderOrder: string;
  summaryStyle: string;
  summaryCron: string;
  commentPollLimit: number;
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  lmStudioTemperature: number;
  lmStudioMaxTokens: number;
  codexCommand: string;
  opencodeCommand: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  emailFrom: string;
  emailTo: string;
  telegramBotToken: string;
  telegramChatId: string;
  webhookSecret: string;
  automatorEnabled: boolean;
  automatorBaseUrl: string;
  automatorToken: string;
  automatorRepoPaths: string;
  automatorTriggers: string;
};

export type Project = {
  id: string;
  owner_type: "org" | "user";
  owner_login: string;
  project_number: number;
  title: string | null;
  enabled: boolean;
  repositories: { id: string; ownerLogin: string; repoName: string; enabled: boolean }[];
};

export type Change = {
  id: string;
  change_type: string;
  actor_login: string | null;
  title: string | null;
  url: string | null;
  summary: string | null;
  repository: string | null;
  occurred_at: string;
  owner_login: string | null;
  project_number: number | null;
  project_title: string | null;
};

export type LinkedRef = {
  relation: "closes" | "references";
  repository: string | null;
  number: number;
  url: string | null;
  title?: string | null;
};

export type ActivityEvent = {
  id: string;
  changeType: string;
  kind: string | null;
  verb: string | null;
  actor: string | null;
  title: string | null;
  url: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  linkedRefs: LinkedRef[];
  source: string;
  occurredAt: string;
  unread: boolean;
};

export type LinkedPr = {
  number: number;
  repository: string | null;
  url: string | null;
  state: string | null;
};

export type ActivityThread = {
  key: string;
  contentId: string | null;
  subjectType: string;
  repository: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  state: string | null;
  project: { ownerLogin: string | null; projectNumber: number | null; title: string | null } | null;
  events: ActivityEvent[];
  linkedRefs: LinkedRef[];
  linkedPrs: LinkedPr[];
  lastEventAt: string;
  unreadCount: number;
  done: boolean;
};

export type ActivityResponse = {
  threads: ActivityThread[];
  facets: { repositories: string[]; actors: string[]; kinds: string[] };
};

export type SyncRun = {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  projects_checked: number;
  changes_found: number;
  error: string | null;
};

export type Summary = {
  id: string;
  provider: string;
  title: string;
  short_body: string;
  body: string;
  change_count: number;
  created_at: string;
};

export type BoardData = {
  id: string;
  title: string;
  owner: string;
  projectNumber: number;
  repositories: string[];
  columns: { name: string; items: BoardItem[] }[];
  openIssues: OpenIssue[];
  pullRequests: { open: BoardPullRequest[]; closed: BoardPullRequest[] };
  issuesError: string | null;
  prsError: string | null;
  lastSyncedAt: string | null;
};

export type BoardItem = {
  id: string;
  contentId: string | null;
  title: string;
  url: string | null;
  type: string;
  state: string | null;
  repository: string | null;
  number: number | null;
  status: string;
  author: string | null;
  assignees: string[];
};

export type BoardLinkedPr = {
  number: number;
  repository: string;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
};

export type OpenIssue = {
  id: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  assignees: string[];
  linkedPullRequests: BoardLinkedPr[];
  updatedAt: string;
  labels: { name: string; color: string }[];
  onBoard: boolean;
};

export type BoardPullRequest = {
  id: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  author: string | null;
  assignees: string[];
  reviewers: string[];
  updatedAt: string;
  onBoard: boolean;
};

export const emptySettings: Settings = {
  githubToken: "",
  pollIntervalMinutes: 60,
  summaryProviderOrder: "lmstudio,codex,opencode,none",
  summaryStyle: "Concise situation summary with what changed, blockers, risks, and next actions.",
  summaryCron: "0 8 * * *",
  commentPollLimit: 50,
  lmStudioBaseUrl: "http://host.docker.internal:1234/v1",
  lmStudioModel: "local-model",
  lmStudioTemperature: 0.2,
  lmStudioMaxTokens: 2000,
  codexCommand: "codex exec",
  opencodeCommand: "opencode run",
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPassword: "",
  emailFrom: "",
  emailTo: "",
  telegramBotToken: "",
  telegramChatId: "",
  webhookSecret: "",
  automatorEnabled: false,
  automatorBaseUrl: "http://host.docker.internal:3001/api/v1",
  automatorToken: "",
  automatorRepoPaths: "",
  automatorTriggers: "",
};

export type AutomatorRunState =
  | "NEW"
  | "PREFLIGHTING"
  | "PLANNING"
  | "READY_TO_BUILD"
  | "BUILDING"
  | "VALIDATING"
  | "REVIEWING"
  | "FIXING"
  | "PR_READY"
  | "AWAITING_APPROVAL"
  | "PR_OPENED"
  | "DONE"
  | "HUMAN_NEEDED"
  | "FAILED"
  | "STOPPED"
  | "PAUSED"
  | (string & {});

export type AutomatorRun = {
  id: string;
  state: AutomatorRunState;
  awaitingHuman: boolean;
  autonomy: "supervised" | "full_auto" | string;
  repoPath: string | null;
  githubRepo: string | null;
  issueNumber: number | null;
  branch: string | null;
  baseRef: string | null;
  dependsOn: unknown[];
  failedCycleCount: number;
  activeStep?: string | null;
  prUrl: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomatorStep = {
  step: string;
  status: string;
  durationMs?: number;
  summary?: string;
  ts: string;
};

export type AutomatorRunDetail = {
  run: AutomatorRun;
  artifacts: string[];
};
