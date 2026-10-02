import { redirect } from "next/navigation";

/** Connections moved to Settings: they're the person's own, not the brand's. */
export default async function MovedToSettings() {
  redirect("/settings/connections");
}
