import { PayloadProbe } from "@/app/_debug/payload-probe";
import { thumbUrl } from "@/lib/images";
import { formatPriceFull } from "@/lib/listings/format";
import { getListingsPayload } from "@/lib/listings/query";

/** Temporary debug view (plan 06). Plan 07 replaces it with the map + list. */
export default async function Home() {
  const payload = await getListingsPayload();
  const first = payload.listings.slice(0, 5);
  return (
    <main className="flex flex-1 flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        renthub map: {payload.listings.length} listings
      </h1>
      <p className="text-sm text-muted-foreground">
        Last scrape:{" "}
        {payload.lastScrapeAt ? (
          <time dateTime={payload.lastScrapeAt}>{payload.lastScrapeAt}</time>
        ) : (
          "never"
        )}
      </p>
      <PayloadProbe payload={payload} />
      <ul className="flex flex-col gap-3">
        {first.map((listing) => (
          <li key={listing.id} className="flex items-center gap-3">
            {listing.cover ? (
              <img
                src={thumbUrl(listing.cover)}
                alt=""
                loading="lazy"
                className="size-16 rounded object-cover"
              />
            ) : (
              <div className="size-16 rounded bg-muted" />
            )}
            <div>
              <div className="font-medium">{listing.name}</div>
              <div className="text-sm text-muted-foreground">
                {[listing.subdistrict, listing.district].filter(Boolean).join(", ")} ·{" "}
                {formatPriceFull(listing.daily, "day")} ·{" "}
                {formatPriceFull(listing.monthly, "month")} · {listing.pictures.length} photos ·
                refreshed {listing.refreshedAt ?? "?"}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
