import type { Metadata } from "next";
import { AgentHome } from "@/modules/timekeeping/agent-home";

export const metadata: Metadata = {
  title: "Espace agent / Agent workspace — SentriQ",
};

export default function AgentPage() {
  return <AgentHome />;
}
