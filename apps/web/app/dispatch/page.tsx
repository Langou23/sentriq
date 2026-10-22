import type { Metadata } from "next";
import { RoleHome } from "@/modules/auth/role-home";

export const metadata: Metadata = {
  title: "Tableau dispatch / Dispatch dashboard — SentriQ",
};

export default function DispatchPage() {
  return <RoleHome role="supervisor" />;
}
