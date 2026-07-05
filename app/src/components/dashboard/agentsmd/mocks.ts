// Sample data for previewing the migration UI when the daemon endpoints aren't
// reachable yet (offline, integration disabled, or the AgentAutomator#6 routes
// not merged). Kept obviously fake so it's never mistaken for real receipts.
import type { DoctorResult, ImportCandidate, ImportLesson, ImportStatus, PendingRule } from "@/server/automator";

export const SAMPLE_AGENTS_MD = `# AGENTS.md

- Always run the tests before saying you're done.
- Don't refactor unrelated code.
- Be concise.
- Please make sure to always be very careful and thorough and think hard about everything.
- Use TypeScript.
- Never use \`any\`.
`;

export const mockImportStatus: ImportStatus = {
  active: false,
  phase: "done",
  stats: { sessionsScanned: 412, candidatesFound: 37, lessonsSynthesized: 9, batchIndex: 8, batchTotal: 8 },
  rateLimitedUntil: null,
  message: "Sample import — daemon offline",
  startedAt: null,
  finishedAt: null,
};

export const mockCandidates: ImportCandidate[] = [
  {
    id: "c1",
    source: "claude",
    project: "Githubers",
    timestamp: "2026-05-14T10:22:00Z",
    score: 0.92,
    signals: ["swearing", "correction", "repeated-ask"],
    userMessage: "no. i told you already, stop adding giant rounded cards everywhere. read the existing components first.",
    assistantBefore: "I've created a new Card component with a rounded-2xl border and generous padding to display the settings...",
  },
  {
    id: "c2",
    source: "codex",
    project: "AgentAutomator",
    timestamp: "2026-05-02T18:41:00Z",
    score: 0.78,
    signals: ["correction"],
    userMessage: "you keep committing to main. always branch first.",
    assistantBefore: "Committed the migration script directly to main and pushed.",
  },
  {
    id: "c3",
    source: "claude",
    project: "Githubers",
    timestamp: "2026-04-21T09:03:00Z",
    score: 0.71,
    signals: ["repeated-ask", "frustration"],
    userMessage: "why are you re-explaining the plan again? just do it.",
    assistantBefore: "Here's my plan before I start: 1) read the file 2) make the change 3) ... Shall I proceed?",
  },
];

export const mockLessons: ImportLesson[] = [
  {
    id: "l1",
    candidateId: "c1",
    rule: "Match existing component look; do not introduce oversized border-radius or gratuitous card borders. Read sibling components before adding UI.",
    scope: "project",
    category: "ui-style",
    project: "Githubers",
    userMessage: mockCandidates[0].userMessage,
  },
  {
    id: "l2",
    candidateId: "c2",
    rule: "Never commit directly to main — always create a branch first.",
    scope: "global",
    category: "git",
    userMessage: mockCandidates[1].userMessage,
  },
];

export const mockPendingRules: PendingRule[] = [
  {
    id: "l1",
    text: mockLessons[0].rule,
    scope: "project",
    category: "ui-style",
    project: "Githubers",
    source: "import",
    fromMessage: mockCandidates[0].userMessage,
    createdAt: "2026-07-05T00:00:00Z",
  },
  {
    id: "l2",
    text: mockLessons[1].rule,
    scope: "global",
    category: "git",
    project: null,
    source: "import",
    fromMessage: mockCandidates[1].userMessage,
    createdAt: "2026-07-05T00:00:00Z",
  },
  {
    id: "l3",
    text: "Don't re-explain the plan or ask to proceed on small, clearly-scoped changes — just make them.",
    scope: "global",
    category: "workflow",
    project: null,
    source: "import",
    fromMessage: mockCandidates[2].userMessage,
    createdAt: "2026-07-05T00:00:00Z",
  },
];

export const mockDoctorResult: DoctorResult = {
  score: 62,
  findings: [
    {
      severity: "medium",
      quote: "Please make sure to always be very careful and thorough and think hard about everything.",
      problem: "Vague filler with no verifiable action. Rules like this don't change behavior and dilute the file.",
      suggestedRewrite: "Delete. If there's a real constraint, state it concretely (e.g. \"run `npm run typecheck` before finishing\").",
    },
    {
      severity: "low",
      quote: "Be concise.",
      problem: "Duplicated intent with other style guidance; also unmeasurable.",
      suggestedRewrite: "Merge into a single style rule with concrete limits.",
    },
    {
      severity: "high",
      quote: "Use TypeScript.  /  Never use `any`.",
      problem: "Two rules that belong together and one restates the language default. Consolidate.",
      suggestedRewrite: "Write TypeScript with no `any`; prefer explicit types at module boundaries.",
    },
  ],
};
