import type { ProjectRow } from "@/server/projects";

type ProjectV2ItemNode = {
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
    updatedAt?: string;
  } | null;
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

const projectQuery = `
  query ProjectState($owner: String!, $number: Int!, $after: String, $isOrg: Boolean!) {
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
              ... on Issue { id title state url number updatedAt author { login } repository { nameWithOwner } }
              ... on PullRequest { id title state url number updatedAt author { login } repository { nameWithOwner } }
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
              ... on Issue { id title state url number updatedAt author { login } repository { nameWithOwner } }
              ... on PullRequest { id title state url number updatedAt author { login } repository { nameWithOwner } }
              ... on DraftIssue { id title }
            }
          }
        }
      }
    }
  }
`;

export async function fetchProjectState(project: ProjectRow, token: string): Promise<ProjectState> {
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
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub GraphQL failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as GraphQlResponse;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error: { message: string }) => error.message).join("; "));
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
