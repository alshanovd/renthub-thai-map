import { AppShell } from "@/components/app-shell";

/**
 * Main screen: a static shell (prerendered, no listing data in the HTML). Pins and cards are
 * fetched from the data API on the client.
 */
export default function Home() {
  return <AppShell />;
}
