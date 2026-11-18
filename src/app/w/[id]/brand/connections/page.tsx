import { redirect } from "next/navigation";

export const metadata = { title: "Connections" };

/** Connections moved to Settings: they're the person's own, not the brand's. */
export default async function MovedToSettings() {
  redirect("/settings/connections");
}
