import { query } from "@/db/client";
import { projectSchema, type ProjectInput } from "@/lib/schemas";

export type ProjectRow = {
  id: string;
  owner_type: "org" | "user";
  owner_login: string;
  project_number: number;
  title: string | null;
  enabled: boolean;
  repositories: { id: string; ownerLogin: string; repoName: string; enabled: boolean }[];
};

export async function listProjects(): Promise<ProjectRow[]> {
  const [projects, repos] = await Promise.all([
    query<Omit<ProjectRow, "repositories">>(
      "SELECT id, owner_type, owner_login, project_number, title, enabled FROM github_projects ORDER BY owner_login, project_number",
    ),
    query<{
    id: string;
    project_id: string;
    owner_login: string;
    repo_name: string;
    enabled: boolean;
  }>("SELECT id, project_id, owner_login, repo_name, enabled FROM github_repositories ORDER BY owner_login, repo_name"),
  ]);

  return projects.rows.map((project) => ({
    ...project,
    repositories: repos.rows
      .filter((repo) => repo.project_id === project.id)
      .map((repo) => ({
        id: repo.id,
        ownerLogin: repo.owner_login,
        repoName: repo.repo_name,
        enabled: repo.enabled,
      })),
  }));
}

export async function createProject(input: ProjectInput) {
  const project = projectSchema.parse(input);
  const result = await query<{ id: string }>(
    `INSERT INTO github_projects (owner_type, owner_login, project_number, title, enabled)
     VALUES ($1, $2, $3, NULLIF($4, ''), $5)
     ON CONFLICT (owner_type, owner_login, project_number)
     DO UPDATE SET title = EXCLUDED.title, enabled = EXCLUDED.enabled, updated_at = now()
     RETURNING id`,
    [project.ownerType, project.ownerLogin, project.projectNumber, project.title, project.enabled],
  );

  const projectId = result.rows[0].id;
  for (const repo of project.repositories) {
    await query(
      `INSERT INTO github_repositories (project_id, owner_login, repo_name, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, owner_login, repo_name)
       DO UPDATE SET enabled = EXCLUDED.enabled`,
      [projectId, repo.ownerLogin, repo.repoName, repo.enabled],
    );
  }

  return projectId;
}

export async function deleteProject(id: string) {
  await query("DELETE FROM github_projects WHERE id = $1", [id]);
}
