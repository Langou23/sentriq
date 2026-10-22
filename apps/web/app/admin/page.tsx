import type { Metadata } from "next";
import { RoleHome } from "@/modules/auth/role-home";

export const metadata: Metadata = {
  title: "Administration / Administration — SentriQ",
};

export default function AdminPage() {
  return <RoleHome role="admin" />;
}
