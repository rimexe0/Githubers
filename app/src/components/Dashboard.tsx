"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Select from "@radix-ui/react-select";
import * as Separator from "@radix-ui/react-separator";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useState, useTransition } from "react";

type Settings = {
  githubToken: string;
  pollIntervalMinutes: number;
  summaryProviderOrder: string;
  summaryStyle: string;
  summaryCron: string;
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
};

type Project = {
  id: string;
  owner_type: "org" | "user";
  owner_login: string;
  project_number: number;
  title: string | null;
  enabled: boolean;
  repositories: { id: string; ownerLogin: string; repoName: string; enabled: boolean }[];
};

type Change = {
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

type SyncRun = {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  projects_checked: number;
  changes_found: number;
  error: string | null;
};

type Summary = {
  id: string;
  provider: string;
  title: string;
  short_body: string;
  body: string;
  change_count: number;
  created_at: string;
};

const emptySettings: Settings = {
  githubToken: "",
  pollIntervalMinutes: 60,
  summaryProviderOrder: "lmstudio,codex,opencode,none",
  summaryStyle: "Concise situation summary with what changed, blockers, risks, and next actions.",
  summaryCron: "0 8 * * *",
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
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function Dashboard() {
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [projects, setProjects] = useState<Project[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [message, setMessage] = useState("Loading dashboard...");
  const [isPending, startTransition] = useTransition();

  const refresh = async () => {
    const [nextSettings, nextProjects, nextChanges, nextSyncRuns, nextSummaries] = await Promise.all([
      api<Settings>("/api/settings"),
      api<Project[]>("/api/projects"),
      api<Change[]>("/api/changes"),
      api<SyncRun[]>("/api/sync"),
      api<Summary[]>("/api/summaries"),
    ]);
    setSettings(nextSettings);
    setProjects(nextProjects);
    setChanges(nextChanges);
    setSyncRuns(nextSyncRuns);
    setSummaries(nextSummaries);
    setMessage("Ready");
  };

  useEffect(() => {
    refresh().catch((error) => setMessage(error.message));
  }, []);

  const runAction = (label: string, action: () => Promise<unknown>) => {
    startTransition(async () => {
      try {
        setMessage(`${label}...`);
        await action();
        await refresh();
        setMessage(`${label} complete`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : `${label} failed`);
      }
    });
  };

  return (
    <Tooltip.Provider>
      <main className="min-h-screen bg-[#0b1020] text-slate-100">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-6 md:px-8">
          <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/20 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Githubers</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Project change watcher</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                LAN/Tailscale dashboard for GitHub Projects v2 polling, Postgres history, local LM Studio summaries, and email/Telegram notifications.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="button-primary" disabled={isPending} onClick={() => runAction("Manual sync", () => api("/api/sync", { method: "POST" }))}>
                Sync now
              </button>
              <button type="button" className="button-secondary" disabled={isPending} onClick={() => runAction("Manual summary", () => api("/api/summaries", { method: "POST" }))}>
                Summarize
              </button>
            </div>
          </header>

          <section className="grid gap-4 md:grid-cols-4">
            <Metric label="Projects" value={projects.length} />
            <Metric label="Recent changes" value={changes.length} />
            <Metric label="Sync runs" value={syncRuns.length} />
            <Metric label="Summaries" value={summaries.length} />
          </section>

          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">{message}</div>

          <Tabs.Root defaultValue="overview" className="rounded-3xl border border-white/10 bg-slate-950/70 p-2">
            <Tabs.List className="flex flex-wrap gap-2 rounded-2xl bg-black/20 p-2">
              {[
                ["overview", "Overview"],
                ["projects", "Projects"],
                ["changes", "Changes"],
                ["summaries", "Summaries"],
                ["settings", "Settings"],
              ].map(([value, label]) => (
                <Tabs.Trigger key={value} value={value} className="tab-trigger">
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Tabs.Content value="overview" className="p-4 md:p-6">
              <Overview projects={projects} syncRuns={syncRuns} summaries={summaries} />
            </Tabs.Content>
            <Tabs.Content value="projects" className="p-4 md:p-6">
              <Projects projects={projects} refresh={refresh} setMessage={setMessage} />
            </Tabs.Content>
            <Tabs.Content value="changes" className="p-4 md:p-6">
              <Changes changes={changes} />
            </Tabs.Content>
            <Tabs.Content value="summaries" className="p-4 md:p-6">
              <Summaries summaries={summaries} />
            </Tabs.Content>
            <Tabs.Content value="settings" className="p-4 md:p-6">
              <SettingsForm settings={settings} setSettings={setSettings} refresh={refresh} setMessage={setMessage} />
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </main>
    </Tooltip.Provider>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function Overview({ projects, syncRuns, summaries }: { projects: Project[]; syncRuns: SyncRun[]; summaries: Summary[] }) {
  const latestSync = syncRuns[0];
  const latestSummary = summaries[0];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Watched projects">
        <div className="space-y-3">
          {projects.map((project) => (
            <div key={project.id} className="rounded-xl bg-white/[0.04] p-4">
              <div className="font-medium">{project.title || `${project.owner_login} #${project.project_number}`}</div>
              <div className="mt-1 text-sm text-slate-400">{project.owner_type}/{project.owner_login} project {project.project_number}</div>
            </div>
          ))}
          {!projects.length && <Empty text="Add your first user or org Project v2 board." />}
        </div>
      </Panel>
      <Panel title="Runtime status">
        <div className="space-y-4 text-sm text-slate-300">
          <p>Latest sync: {latestSync ? `${latestSync.status}, ${latestSync.changes_found} changes` : "No sync runs yet"}</p>
          <p>Latest summary: {latestSummary ? `${latestSummary.provider}, ${latestSummary.change_count} changes` : "No summaries yet"}</p>
          <p>Scheduler: initialized by Next.js instrumentation in self-hosted Node runtime.</p>
        </div>
      </Panel>
    </div>
  );
}

function Projects({ projects, refresh, setMessage }: { projects: Project[]; refresh: () => Promise<void>; setMessage: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [ownerType, setOwnerType] = useState<"org" | "user">("org");
  const [ownerLogin, setOwnerLogin] = useState("");
  const [projectNumber, setProjectNumber] = useState("");
  const [title, setTitle] = useState("");
  const [repos, setRepos] = useState("");

  const save = async () => {
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        ownerType,
        ownerLogin,
        projectNumber: Number(projectNumber),
        title,
        repositories: repos
          .split("\n")
          .flatMap((line) => {
            const repo = line.trim();
            if (!repo) return [];
            const [repoOwner, repoName] = repo.split("/");
            return repoOwner && repoName ? [{ ownerLogin: repoOwner, repoName }] : [];
          }),
      }),
    });
    setOpen(false);
    setOwnerLogin("");
    setProjectNumber("");
    setTitle("");
    setRepos("");
    await refresh();
    setMessage("Project saved");
  };

  return (
    <Panel title="Projects" action={<button type="button" className="button-primary" onClick={() => setOpen(true)}>Add project</button>}>
      <div className="space-y-3">
        {projects.map((project) => (
          <div key={project.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-medium">{project.title || `${project.owner_login} #${project.project_number}`}</div>
              <div className="text-sm text-slate-400">{project.owner_type}/{project.owner_login} project {project.project_number}</div>
              <div className="mt-2 text-xs text-slate-500">Repos: {project.repositories.map((repo) => `${repo.ownerLogin}/${repo.repoName}`).join(", ") || "none configured"}</div>
            </div>
            <AlertDialog.Root>
              <AlertDialog.Trigger asChild><button type="button" className="button-danger">Delete</button></AlertDialog.Trigger>
              <AlertDialog.Portal>
                <AlertDialog.Overlay className="dialog-overlay" />
                <AlertDialog.Content className="dialog-content">
                  <AlertDialog.Title className="text-lg font-semibold">Delete project?</AlertDialog.Title>
                  <AlertDialog.Description className="mt-2 text-sm text-slate-300">This removes the project config and stored child records.</AlertDialog.Description>
                  <div className="mt-6 flex justify-end gap-3">
                    <AlertDialog.Cancel className="button-secondary">Cancel</AlertDialog.Cancel>
                    <AlertDialog.Action className="button-danger" onClick={async () => { await api(`/api/projects/${project.id}`, { method: "DELETE" }); await refresh(); }}>Delete</AlertDialog.Action>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          </div>
        ))}
        {!projects.length && <Empty text="No projects configured yet." />}
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content max-w-2xl">
            <Dialog.Title className="text-xl font-semibold">Add GitHub Project v2</Dialog.Title>
            <div className="mt-5 grid gap-4">
              <label className="field-label" id="owner-type-label" htmlFor="owner-type-trigger">Owner type</label>
              <Select.Root value={ownerType} onValueChange={(value) => setOwnerType(value as "org" | "user")}>
                <Select.Trigger id="owner-type-trigger" className="input" aria-labelledby="owner-type-label"><Select.Value /></Select.Trigger>
                <Select.Portal><Select.Content className="select-content"><Select.Item className="select-item" value="org">Org</Select.Item><Select.Item className="select-item" value="user">User</Select.Item></Select.Content></Select.Portal>
              </Select.Root>
              <Input label="Owner login" value={ownerLogin} onChange={setOwnerLogin} />
              <Input label="Project number" value={projectNumber} onChange={setProjectNumber} />
              <Input label="Display title" value={title} onChange={setTitle} />
              <label className="field-label" htmlFor="project-repos">Linked repos, one owner/name per line</label>
              <textarea id="project-repos" className="input min-h-28" value={repos} onChange={(event) => setRepos(event.target.value)} placeholder="my-org/private-repo" />
              <div className="flex justify-end gap-3"><Dialog.Close className="button-secondary">Cancel</Dialog.Close><button type="button" className="button-primary" onClick={save}>Save</button></div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Panel>
  );
}

function Changes({ changes }: { changes: Change[] }) {
  return (
    <Panel title="Recent changes">
      <ScrollArea.Root className="h-[540px] overflow-hidden rounded-xl border border-white/10">
        <ScrollArea.Viewport className="h-full w-full">
          <div className="divide-y divide-white/10">
            {changes.map((change) => (
              <article key={change.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>{change.change_type}</span><span>{new Date(change.occurred_at).toLocaleString()}</span><span>{change.repository}</span></div>
                <h3 className="mt-2 font-medium">{change.url ? <a className="text-cyan-200 hover:underline" href={change.url} target="_blank">{change.title}</a> : change.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{change.summary}</p>
              </article>
            ))}
            {!changes.length && <Empty text="No changes captured yet. Run sync after configuring a token and project." />}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar" orientation="vertical"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </Panel>
  );
}

function Summaries({ summaries }: { summaries: Summary[] }) {
  return (
    <Panel title="Summaries">
      <div className="space-y-4">
        {summaries.map((summary) => (
          <article key={summary.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs uppercase tracking-widest text-cyan-300">{summary.provider} · {summary.change_count} changes · {new Date(summary.created_at).toLocaleString()}</div>
            <h3 className="mt-2 text-lg font-semibold">{summary.title}</h3>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{summary.short_body}</p>
          </article>
        ))}
        {!summaries.length && <Empty text="No summaries yet." />}
      </div>
    </Panel>
  );
}

function SettingsForm({ settings, setSettings, refresh, setMessage }: { settings: Settings; setSettings: (settings: Settings) => void; refresh: () => Promise<void>; setMessage: (message: string) => void }) {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });
  const save = async () => {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
    await refresh();
    setMessage("Settings saved");
  };

  return (
    <Panel title="Settings" action={<button type="button" className="button-primary" onClick={save}>Save settings</button>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="font-semibold">GitHub and scheduling</h3>
          <Input label="GitHub token" type="password" value={settings.githubToken} onChange={(value) => update("githubToken", value)} />
          <Input label="Poll interval minutes" value={String(settings.pollIntervalMinutes)} onChange={(value) => update("pollIntervalMinutes", Number(value))} />
          <Input label="Daily summary cron" value={settings.summaryCron} onChange={(value) => update("summaryCron", value)} />
          <Separator.Root className="h-px bg-white/10" />
          <h3 className="font-semibold">Summarizers</h3>
          <Input label="Provider order" value={settings.summaryProviderOrder} onChange={(value) => update("summaryProviderOrder", value)} />
          <Input label="LM Studio base URL" value={settings.lmStudioBaseUrl} onChange={(value) => update("lmStudioBaseUrl", value)} />
          <Input label="LM Studio model" value={settings.lmStudioModel} onChange={(value) => update("lmStudioModel", value)} />
          <Input label="Codex command" value={settings.codexCommand} onChange={(value) => update("codexCommand", value)} />
          <Input label="OpenCode command" value={settings.opencodeCommand} onChange={(value) => update("opencodeCommand", value)} />
        </div>
        <div className="space-y-4">
          <h3 className="font-semibold">Summary style</h3>
          <label className="sr-only" htmlFor="summary-style">Summary style</label>
          <textarea id="summary-style" className="input min-h-32" value={settings.summaryStyle} onChange={(event) => update("summaryStyle", event.target.value)} />
          <h3 className="font-semibold">Email</h3>
          <Input label="SMTP host" value={settings.smtpHost} onChange={(value) => update("smtpHost", value)} />
          <Input label="SMTP port" value={String(settings.smtpPort)} onChange={(value) => update("smtpPort", Number(value))} />
          <Input label="SMTP user" value={settings.smtpUser} onChange={(value) => update("smtpUser", value)} />
          <Input label="SMTP password" type="password" value={settings.smtpPassword} onChange={(value) => update("smtpPassword", value)} />
          <Input label="Email from" value={settings.emailFrom} onChange={(value) => update("emailFrom", value)} />
          <Input label="Email to" value={settings.emailTo} onChange={(value) => update("emailTo", value)} />
          <button type="button" className="button-secondary" onClick={() => api("/api/notifications/test-email", { method: "POST" }).then(() => setMessage("Test email sent")).catch((error) => setMessage(error.message))}>Test email</button>
          <h3 className="font-semibold">Telegram</h3>
          <Input label="Bot token" type="password" value={settings.telegramBotToken} onChange={(value) => update("telegramBotToken", value)} />
          <Input label="Chat ID" value={settings.telegramChatId} onChange={(value) => update("telegramChatId", value)} />
          <button type="button" className="button-secondary" onClick={() => api("/api/notifications/test-telegram", { method: "POST" }).then(() => setMessage("Test Telegram sent")).catch((error) => setMessage(error.message))}>Test Telegram</button>
        </div>
      </div>
    </Panel>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">{title}</h2>{action}</div>{children}</section>;
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block"><span className="field-label">{label}</span><input className="input mt-2" type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">{text}</div>;
}
