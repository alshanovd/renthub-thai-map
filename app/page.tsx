import { AppShell } from "@/components/app-shell";
import { getListingsPayload } from "@/lib/listings/query";

/** Main screen. The payload is cached (`"use cache"`), so `/` stays prerendered. */
export default async function Home() {
  const payload = await getListingsPayload();
  return <AppShell payload={payload} />;
}
