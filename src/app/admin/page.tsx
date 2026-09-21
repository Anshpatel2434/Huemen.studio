import { redirect } from "next/navigation";

/** Old admin console URL — the console now lives under Settings. */
export default function AdminRedirect() {
  redirect("/settings/workspaces");
}
