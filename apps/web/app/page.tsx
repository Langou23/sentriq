import { Suspense } from "react";
import { AuthPageLoading } from "@/modules/auth/page-loading";
import { redirectToRoleHome } from "@/modules/auth/server";

async function HomeRedirect() {
  await redirectToRoleHome();
  return null;
}

export default function Home() {
  return (
    <Suspense fallback={<AuthPageLoading />}>
      <HomeRedirect />
    </Suspense>
  );
}
