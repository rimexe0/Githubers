import type { ProjectRow } from "@/server/projects";

export type ProjectV2ItemNode = {
  id: string;
  type: string;
  fieldValues: {
    nodes: unknown[];
  };
  content?: {
    __typename: string;
    id: string;
    title?: string;
    state?: string;
    url?: string;
    number?: number;
    repository?: {
      nameWithOwner: string;
    };
    author?: {
      login: string;
    };
    assignees?: {
      nodes: { login: string }[];
    };
    labels?: {
      nodes: { name: string; color: string }[];
    };
    reviews?: {
      nodes: ReviewNode[];
    };
    closingIssuesReferences?: {
      nodes: { number: number; title?: string; url?: string; repository?: { nameWithOwner: string } }[];
    };
    updatedAt?: string;
    comments?: {
      nodes: CommentNode[];
    };
  } | null;
};

export type ReviewNode = {
  id: string;
  state: string;
  body: string;
  url: string;
  submittedAt: string | null;
  author?: { login: string } | null;
};

export type CommentNode = {
  id: string;
  author?: { login: string } | null;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectState = {
  title: string;
  items: ProjectV2ItemNode[];
};

type ProjectV2ResponseNode = {
  title: string;
  items: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ProjectV2ItemNode[];
  };
};

type GraphQlResponse = {
  data?: {
    organization?: { projectV2?: ProjectV2ResponseNode | null } | null;
    user?: { projectV2?: ProjectV2ResponseNode | null } | null;
  };
  errors?: { message: string }[];
};

function formatGraphQlErrors(errors: { message: string }[]) {
  const message = errors.map((error) => error.message).join("; ");
  if (message.includes("Resource not accessible by personal access token")) {
    return `${message}. GitHub Projects v2 requires a classic PAT with repo + read:project; fine-grained PATs cannot read Projects v2.`;
  }
  return message;
}

const projectQuery = `
  query ProjectState($owner: String!, $number: Int!, $after: String, $isOrg: Boolean!, $commentPollLimit: Int!) {
    organization(login: $owner) @include(if: $isOrg) {
      projectV2(number: $number) {
        title
        items(first: 50, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            type
            fieldValues(first: 30) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldUserValue { users(first: 10) { nodes { login } } field { ... on ProjectV2FieldCommon { name } } }
              }
            }
            content {
              __typename
              ... on Issue { id title state url number updatedAt author { login } assignees(first: 5) { nodes { login } } labels(first: 10) { nodes { name color } } repository { nameWithOwner } comments(first: $commentPollLimit, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { id body url createdAt updatedAt author { login } } } }
              ... on PullRequest { id title state url number updatedAt author { login } assignees(first: 5) { nodes { login } } labels(first: 10) { nodes { name color } } reviews(last: 20) { nodes { id state body url submittedAt author { login } } } closingIssuesReferences(first: 10) { nodes { number title url repository { nameWithOwner } } } repository { nameWithOwner } comments(first: $commentPollLimit, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { id body url createdAt updatedAt author { login } } } }
              ... on DraftIssue { id title }
            }
          }
        }
      }
    }
    user(login: $owner) @skip(if: $isOrg) {
      projectV2(number: $number) {
        title
        items(first: 50, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            type
            fieldValues(first: 30) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldUserValue { users(first: 10) { nodes { login } } field { ... on ProjectV2FieldCommon { name } } }
              }
            }
            content {
              __typename
              ... on Issue { id title state url number updatedAt author { login } assignees(first: 5) { nodes { login } } labels(first: 10) { nodes { name color } } repository { nameWithOwner } comments(first: $commentPollLimit, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { id body url createdAt updatedAt author { login } } } }
              ... on PullRequest { id title state url number updatedAt author { login } assignees(first: 5) { nodes { login } } labels(first: 10) { nodes { name color } } reviews(last: 20) { nodes { id state body url submittedAt author { login } } } closingIssuesReferences(first: 10) { nodes { number title url repository { nameWithOwner } } } repository { nameWithOwner } comments(first: $commentPollLimit, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { id body url createdAt updatedAt author { login } } } }
              ... on DraftIssue { id title }
            }
          }
        }
      }
    }
  }
`;

export type RepoIssueNode = {
  id: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  author?: { login: string } | null;
  assignees?: { nodes: { login: string }[] } | null;
  labels?: { nodes: { name: string; color: string }[] } | null;
};

export type RepoPullRequestNode = {
  id: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  updatedAt: string;
  author?: { login: string } | null;
  assignees?: { nodes: { login: string }[] } | null;
  reviewRequests?: { nodes: { requestedReviewer?: { login?: string } | null }[] } | null;
  closingIssuesReferences?: { nodes: { number: number; repository: { nameWithOwner: string } }[] } | null;
};

type OpenIssuesResponse = {
  data?: Record<string, { issues?: { nodes: RepoIssueNode[] } } | null> | null;
  errors?: { message: string }[];
};

type PullRequestsResponse = {
  data?: Record<
    string,
    {
      openPullRequests?: { nodes: RepoPullRequestNode[] };
      closedPullRequests?: { nodes: RepoPullRequestNode[] };
    } | null
  > | null;
  errors?: { message: string }[];
};

export async function fetchOpenIssues(
  repos: { ownerLogin: string; repoName: string }[],
  token: string,
  limit = 30,
): Promise<{ repository: string; issues: RepoIssueNode[] }[]> {
  if (!repos.length) return [];
  if (!token) throw new Error("GitHub token is not configured");

  const variableDefs = ["$limit: Int!", ...repos.map((_, index) => `$owner${index}: String!, $name${index}: String!`)].join(", ");
  const selections = repos
    .map(
      (_, index) => `
        repo${index}: repository(owner: $owner${index}, name: $name${index}) {
          issues(states: [OPEN], first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes { id number title url updatedAt author { login } assignees(first: 5) { nodes { login } } labels(first: 5) { nodes { name color } } }
          }
        }`,
    )
    .join("\n");

  const variables: Record<string, string | number> = { limit };
  repos.forEach((repo, index) => {
    variables[`owner${index}`] = repo.ownerLogin;
    variables[`name${index}`] = repo.repoName;
  });

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "github-project-change-watcher",
    },
    body: JSON.stringify({ query: `query OpenIssues(${variableDefs}) { ${selections} }`, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as OpenIssuesResponse;
  // Missing repos surface as per-alias nulls alongside errors; only fail when nothing came back.
  if (payload.errors?.length && !payload.data) {
    throw new Error(formatGraphQlErrors(payload.errors));
  }

  return repos.map((repo, index) => ({
    repository: `${repo.ownerLogin}/${repo.repoName}`,
    issues: payload.data?.[`repo${index}`]?.issues?.nodes ?? [],
  }));
}

export async function fetchPullRequests(
  repos: { ownerLogin: string; repoName: string }[],
  token: string,
  limit = 30,
): Promise<{ repository: string; open: RepoPullRequestNode[]; closed: RepoPullRequestNode[] }[]> {
  if (!repos.length) return [];
  if (!token) throw new Error("GitHub token is not configured");

  const variableDefs = ["$limit: Int!", ...repos.map((_, index) => `$owner${index}: String!, $name${index}: String!`)].join(", ");
  const selections = repos
    .map(
      (_, index) => `
        repo${index}: repository(owner: $owner${index}, name: $name${index}) {
          openPullRequests: pullRequests(states: [OPEN], first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes { id number title url state updatedAt author { login } assignees(first: 5) { nodes { login } } reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } } closingIssuesReferences(first: 5) { nodes { number repository { nameWithOwner } } } }
          }
          closedPullRequests: pullRequests(states: [CLOSED, MERGED], first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes { id number title url state updatedAt author { login } assignees(first: 5) { nodes { login } } reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } } closingIssuesReferences(first: 5) { nodes { number repository { nameWithOwner } } } }
          }
        }`,
    )
    .join("\n");

  const variables: Record<string, string | number> = { limit };
  repos.forEach((repo, index) => {
    variables[`owner${index}`] = repo.ownerLogin;
    variables[`name${index}`] = repo.repoName;
  });

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "github-project-change-watcher",
    },
    body: JSON.stringify({ query: `query PullRequests(${variableDefs}) { ${selections} }`, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as PullRequestsResponse;
  if (payload.errors?.length && !payload.data) {
    throw new Error(formatGraphQlErrors(payload.errors));
  }

  return repos.map((repo, index) => ({
    repository: `${repo.ownerLogin}/${repo.repoName}`,
    open: payload.data?.[`repo${index}`]?.openPullRequests?.nodes ?? [],
    closed: payload.data?.[`repo${index}`]?.closedPullRequests?.nodes ?? [],
  }));
}

// The project-state query deliberately omits issue bodies (they'd bloat every
// snapshot and churn the hash). The automator trigger needs the raw markdown
// body to send as source.body, so fetch it on demand only for the few issues
// actually sitting in a trigger column. Returns "owner/repo#number" -> body.
export async function fetchIssueBodies(
  issues: { repository: string; number: number }[],
  token: string,
): Promise<Record<string, string>> {
  if (!issues.length) return {};
  if (!token) throw new Error("GitHub token is not configured");

  const variableDefs = issues.map((_, index) => `$owner${index}: String!, $name${index}: String!, $number${index}: Int!`).join(", ");
  const selections = issues
    .map(
      (_, index) => `
        issue${index}: repository(owner: $owner${index}, name: $name${index}) {
          issue(number: $number${index}) { number body }
        }`,
    )
    .join("\n");

  const variables: Record<string, string | number> = {};
  issues.forEach((issue, index) => {
    const [ownerLogin, repoName] = issue.repository.split("/");
    variables[`owner${index}`] = ownerLogin;
    variables[`name${index}`] = repoName;
    variables[`number${index}`] = issue.number;
  });

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "github-project-change-watcher",
    },
    body: JSON.stringify({ query: `query IssueBodies(${variableDefs}) { ${selections} }`, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: Record<string, { issue?: { number: number; body: string | null } | null } | null> | null;
    errors?: { message: string }[];
  };
  if (payload.errors?.length && !payload.data) {
    throw new Error(formatGraphQlErrors(payload.errors));
  }

  const bodies: Record<string, string> = {};
  issues.forEach((issue, index) => {
    const body = payload.data?.[`issue${index}`]?.issue?.body;
    bodies[`${issue.repository}#${issue.number}`] = body ?? "";
  });
  return bodies;
}

type UpdatedAtResponse = {
  data?: Record<string, { projectV2?: { updatedAt: string } | null } | null> | null;
  errors?: { message: string }[];
};

// Freshness probe: ~1 rate-limit point per project, vs hundreds for a full sync.
export async function fetchProjectUpdatedAts(projects: ProjectRow[], token: string): Promise<Record<string, string>> {
  if (!projects.length) return {};
  if (!token) throw new Error("GitHub token is not configured");

  const variableDefs = projects.map((_, index) => `$owner${index}: String!, $number${index}: Int!`).join(", ");
  const selections = projects
    .map(
      (project, index) =>
        `p${index}: ${project.owner_type === "org" ? "organization" : "user"}(login: $owner${index}) { projectV2(number: $number${index}) { updatedAt } }`,
    )
    .join("\n");

  const variables: Record<string, string | number> = {};
  projects.forEach((project, index) => {
    variables[`owner${index}`] = project.owner_login;
    variables[`number${index}`] = project.project_number;
  });

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "github-project-change-watcher",
    },
    body: JSON.stringify({ query: `query ProjectUpdatedAts(${variableDefs}) { ${selections} }`, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as UpdatedAtResponse;
  if (payload.errors?.length && !payload.data) {
    throw new Error(formatGraphQlErrors(payload.errors));
  }

  const updatedAts: Record<string, string> = {};
  projects.forEach((project, index) => {
    const updatedAt = payload.data?.[`p${index}`]?.projectV2?.updatedAt;
    if (updatedAt) updatedAts[project.id] = updatedAt;
  });
  return updatedAts;
}

export async function fetchProjectState(project: ProjectRow, token: string, commentPollLimit = 50): Promise<ProjectState> {
  if (!token) throw new Error("GitHub token is not configured");

  const items: ProjectV2ItemNode[] = [];
  let after: string | null = null;
  let title = project.title ?? `${project.owner_login} #${project.project_number}`;

  do {
    const response: Response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "github-project-change-watcher",
      },
      body: JSON.stringify({
        query: projectQuery,
        variables: {
          owner: project.owner_login,
          number: project.project_number,
          after,
          isOrg: project.owner_type === "org",
          commentPollLimit,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub GraphQL failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as GraphQlResponse;
    if (payload.errors?.length) {
      throw new Error(formatGraphQlErrors(payload.errors));
    }

    const node: ProjectV2ResponseNode | null | undefined =
      project.owner_type === "org" ? payload.data?.organization?.projectV2 : payload.data?.user?.projectV2;
    if (!node) throw new Error(`Project not found: ${project.owner_login} #${project.project_number}`);

    title = node.title;
    items.push(...node.items.nodes);
    after = node.items.pageInfo.hasNextPage ? node.items.pageInfo.endCursor : null;
  } while (after);

  return { title, items };
}
