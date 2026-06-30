"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Project } from "./types";
import { api, parseRepos } from "./utils";

type ProjectFormState = {
  ownerType: "org" | "user";
  ownerLogin: string;
  projectNumber: string;
  title: string;
  repos: string;
};

type ProjectFormAction =
  | { type: "field"; key: keyof ProjectFormState; value: string }
  | { type: "ownerType"; value: "org" | "user" }
  | { type: "load"; project: Project }
  | { type: "reset" };

const emptyProjectForm: ProjectFormState = { ownerType: "org", ownerLogin: "", projectNumber: "", title: "", repos: "" };

function projectFormReducer(state: ProjectFormState, action: ProjectFormAction): ProjectFormState {
  if (action.type === "reset") return emptyProjectForm;
  if (action.type === "load") {
    return {
      ownerType: action.project.owner_type,
      ownerLogin: action.project.owner_login,
      projectNumber: String(action.project.project_number),
      title: action.project.title ?? "",
      repos: action.project.repositories.map((repo) => `${repo.ownerLogin}/${repo.repoName}`).join("\n"),
    };
  }
  if (action.type === "ownerType") return { ...state, ownerType: action.value };
  return { ...state, [action.key]: action.value };
}

export function ProjectDialog({
  open,
  editingProject,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editingProject: Project | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, dispatchForm] = useReducer(projectFormReducer, emptyProjectForm);

  useEffect(() => {
    if (!open) return;
    if (editingProject) dispatchForm({ type: "load", project: editingProject });
    else dispatchForm({ type: "reset" });
  }, [open, editingProject]);

  const save = async () => {
    await api(editingProject ? `/api/projects/${editingProject.id}` : "/api/projects", {
      method: editingProject ? "PUT" : "POST",
      body: JSON.stringify({
        ownerType: form.ownerType,
        ownerLogin: form.ownerLogin,
        projectNumber: Number(form.projectNumber),
        title: form.title,
        repositories: parseRepos(form.repos),
      }),
    });
    onOpenChange(false);
    await onSaved(editingProject ? "Project updated" : "Project saved");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingProject ? "Edit GitHub Project v2" : "Add GitHub Project v2"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="owner-type-trigger">Owner type</Label>
            <Select value={form.ownerType} onValueChange={(value) => dispatchForm({ type: "ownerType", value: value as "org" | "user" })}>
              <SelectTrigger id="owner-type-trigger" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="org">Org</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Field label="Owner login" value={form.ownerLogin} onChange={(value) => dispatchForm({ type: "field", key: "ownerLogin", value })} />
          <Field label="Project number" value={form.projectNumber} onChange={(value) => dispatchForm({ type: "field", key: "projectNumber", value })} />
          <Field label="Display title" value={form.title} onChange={(value) => dispatchForm({ type: "field", key: "title", value })} />
          <div className="grid gap-1.5">
            <Label htmlFor="project-repos">Linked repos, one owner/name per line</Label>
            <Textarea id="project-repos" className="min-h-24" value={form.repos} onChange={(event) => dispatchForm({ type: "field", key: "repos", value: event.target.value })} placeholder="my-org/private-repo" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline" size="sm">Cancel</Button></DialogClose>
          <Button type="button" size="sm" onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
