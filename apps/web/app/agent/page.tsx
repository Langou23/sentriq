import type { Metadata } from "next";
import { RoleHome } from "@/modules/auth/role-home";

export const metadata: Metadata = {
  title: "Espace agent / Agent workspace — SentriQ",
};

export default function AgentPage() {
  return <RoleHome role="agent" />;
}
