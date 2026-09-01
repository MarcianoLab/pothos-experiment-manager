import OperatorApp from "./components/OperatorApp";
import { redirect } from "next/navigation";
import { hasAccessCookie } from "./lib/access";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await hasAccessCookie())) redirect("/login");
  return <OperatorApp />;
}
