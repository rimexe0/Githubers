import { Dashboard } from "@/components/Dashboard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Githubers Dashboard",
  description: "Track and summarize GitHub Projects v2 changes.",
};

export default function Home() {
  return <Dashboard />;
}
