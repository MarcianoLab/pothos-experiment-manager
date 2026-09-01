import { redirect } from "next/navigation";
import { hasAccessCookie } from "../lib/access";

export const dynamic = "force-dynamic";

export default async function DisplayLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!(await hasAccessCookie())) redirect("/login?next=/display");
  return children;
}
