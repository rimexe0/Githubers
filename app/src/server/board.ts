import { query } from "@/db/client";
import { fetchAutomatorOpenIssues, fetchAutomatorPullRequests, getAutomatorConfig } from "@/server/automator";
import { fetchOpenIssues, fetchPullRequests } from "@/server/github";
import { getSettings } from "@/server/settings";

type SnapshotContent = {
  __typename?: string;
  id?: string;
  title?: string;
  state?: string;
  url?: string;
  number?: number;
  repository?: { nameWithOwner: string };
  author?: { login: string };
  assignees?: { nodes: { login: string }[] };
  updatedAt?: string;
} | null;

type ItemSnapshot = {
  githubItemId: string;
  type: string;
  content: SnapshotContent;
  fieldValues: { __typename?: string; name?: string; field?: { name?: string } }[];
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

export type BoardOpenIssue = {
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

const NO_STATUS = "No status";

// Snapshots don't carry the project's single-select option order, so approximate a kanban order.
const columnPriority = ["backlog", "ready", "todo", "to do", "in progress", "in review", "review", "testing", "blocked", "done"];

function columnRank(name: string) {
  if (name === NO_STATUS) return columnPriority.length + 1;
  const index = columnPriority.indexOf(name.toLowerCase());
  return index === -1 ? columnPriority.length : index;
}

function extractStatus(fieldValues: ItemSnapshot["fieldValues"]) {
  for (const value of fieldValues ?? []) {
    if (value?.__typename === "ProjectV2ItemFieldSingleSelectValue" && value.field?.name === "Status" && value.name) {
      return value.name;
    }
  }
  return NO_STATUS;
}

export async function withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>, label: string): Promise<T> {
  try { return await primary(); }
  catch (error) { console.warn(`${label}; falling back to GitHub GraphQL`, error); return fallback(); }
}

async function fetchOpenIssuesWithFallback(repoList: { ownerLogin: string; repoName: string }[], githubToken: string) {
  return withFallback(
    async () => fetchAutomatorOpenIssues(await getAutomatorConfig(), repoList),
    () => fetchOpenIssues(repoList, githubToken),
    "automator github issues unavailable",
  );
}

async function fetchPullRequestsWithFallback(repoList: { ownerLogin: string; repoName: string }[], githubToken: string) {
  return withFallback(
    async () => fetchAutomatorPullRequests(await getAutomatorConfig(), repoList),
    () => fetchPullRequests(repoList, githubToken),
    "automator github pulls unavailable",
  );
}

export async function getProjectBoard(projectId: string) {
  const projectResult = await query<{
    id: string;
    owner_type: string;
    owner_login: string;
    project_number: number;
    title: string | null;
  }>("SELECT id, owner_type, owner_login, project_number, title FROM github_projects WHERE id = $1", [projectId]);
  if (projectResult.rowCount === 0) throw new Error("Project not found");
  const project = projectResult.rows[0];

  const [repos, items] = await Promise.all([
    query<{ owner_login: string; repo_name: string }>(
      "SELECT owner_login, repo_name FROM github_repositories WHERE project_id = $1 AND enabled ORDER BY owner_login, repo_name",
      [projectId],
    ),
    query<{ raw: ItemSnapshot; updated_at: string }>(
      "SELECT raw, updated_at FROM project_items WHERE project_id = $1 ORDER BY updated_at DESC",
      [projectId],
    ),
  ]);

  const boardItems: BoardItem[] = items.rows.map((row) => {
    const snapshot = row.raw;
    const content = snapshot.content;
    return {
      id: snapshot.githubItemId,
      contentId: content?.id ?? null,
      title: content?.title ?? "Untitled item",
      url: content?.url ?? null,
      type: content?.__typename ?? snapshot.type,
      state: content?.state ?? null,
      repository: content?.repository?.nameWithOwner ?? null,
      number: content?.number ?? null,
      status: extractStatus(snapshot.fieldValues),
      author: content?.author?.login ?? null,
      assignees: content?.assignees?.nodes?.map((assignee) => assignee.login) ?? [],
    };
  });

  const columnNames = Array.from(new Set(boardItems.map((item) => item.status))).toSorted(
    (a, b) => columnRank(a) - columnRank(b) || a.localeCompare(b),
  );
  const columns = columnNames.map((name) => ({ name, items: boardItems.filter((item) => item.status === name) }));

  const onBoardIds = new Set(boardItems.flatMap((item) => (item.contentId ? [item.contentId] : [])));
  let openIssues: BoardOpenIssue[] = [];
  let pullRequests: { open: BoardPullRequest[]; closed: BoardPullRequest[] } = { open: [], closed: [] };
  let issuesError: string | null = null;
  let prsError: string | null = null;
  const repoList = repos.rows.map((repo) => ({ ownerLogin: repo.owner_login, repoName: repo.repo_name }));
  const settings = await getSettings();
  try {
    const results = await fetchOpenIssuesWithFallback(repoList, settings.githubToken);
    openIssues = results
      .flatMap((result) =>
        result.issues.map((issue) => ({
          id: issue.id,
          repository: result.repository,
          number: issue.number,
          title: issue.title,
          url: issue.url,
          author: issue.author?.login ?? null,
          assignees: issue.assignees?.nodes?.map((assignee) => assignee.login) ?? [],
          linkedPullRequests: [] as BoardLinkedPr[],
          updatedAt: issue.updatedAt,
          labels: issue.labels?.nodes ?? [],
          onBoard: onBoardIds.has(issue.id),
        })),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    issuesError = error instanceof Error ? error.message : "Failed to fetch open issues";
  }

  // issueKey ("owner/repo#number") -> PRs that declare they close it, built while mapping PRs.
  const prsByIssue = new Map<string, BoardLinkedPr[]>();
  try {
    const results = await fetchPullRequestsWithFallback(repoList, settings.githubToken);
    const mapPullRequest = (repository: string, pr: { id: string; number: number; title: string; url: string; state: "OPEN" | "CLOSED" | "MERGED"; author?: { login: string } | null; assignees?: { nodes: { login: string }[] } | null; reviewRequests?: { nodes: { requestedReviewer?: { login?: string } | null }[] } | null; closingIssuesReferences?: { nodes: { number: number; repository: { nameWithOwner: string } }[] } | null; updatedAt: string }) => {
      for (const ref of pr.closingIssuesReferences?.nodes ?? []) {
        const key = `${ref.repository.nameWithOwner}#${ref.number}`;
        const list = prsByIssue.get(key) ?? [];
        list.push({ number: pr.number, repository, title: pr.title, url: pr.url, state: pr.state });
        prsByIssue.set(key, list);
      }
      return {
        id: pr.id,
        repository,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        author: pr.author?.login ?? null,
        assignees: pr.assignees?.nodes?.map((assignee) => assignee.login) ?? [],
        reviewers: pr.reviewRequests?.nodes?.flatMap((node) => (node.requestedReviewer?.login ? [node.requestedReviewer.login] : [])) ?? [],
        updatedAt: pr.updatedAt,
        onBoard: onBoardIds.has(pr.id),
      };
    };
    pullRequests = {
      open: results
        .flatMap((result) => result.open.map((pr) => mapPullRequest(result.repository, pr)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      closed: results
        .flatMap((result) => result.closed.map((pr) => mapPullRequest(result.repository, pr)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  } catch (error) {
    prsError = error instanceof Error ? error.message : "Failed to fetch pull requests";
  }

  // Attach each open issue's linked PRs (newest first) now that PR references are known.
  openIssues = openIssues.map((issue) => ({
    ...issue,
    linkedPullRequests: (prsByIssue.get(`${issue.repository}#${issue.number}`) ?? []).sort((a, b) => b.number - a.number),
  }));

  return {
    id: project.id,
    title: project.title ?? `${project.owner_login} #${project.project_number}`,
    owner: `${project.owner_type}/${project.owner_login}`,
    projectNumber: project.project_number,
    repositories: repoList.map((repo) => `${repo.ownerLogin}/${repo.repoName}`),
    columns,
    openIssues,
    pullRequests,
    issuesError,
    prsError,
    lastSyncedAt: items.rows[0]?.updated_at ?? null,
  };
}
