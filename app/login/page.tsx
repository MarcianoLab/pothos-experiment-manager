import { redirect } from "next/navigation";
import { hasAccessCookie } from "../lib/access";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await hasAccessCookie()) redirect("/");
  return <LoginForm />;
}
