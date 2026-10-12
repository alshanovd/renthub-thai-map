import { describe, expect, it } from "vitest";

import { fullUrl, listingUrl, thumbUrl } from "./images";

describe("image helpers", () => {
  const path = "/listing_picture/202210/20221016/x9YoktzMV1tvpqcZCVNR.jpg";

  it("builds thumbnail and full CDN URLs", () => {
    expect(thumbUrl(path)).toBe(`https://bcdn.renthub.in.th${path}?class=thumbnail`);
    expect(fullUrl(path)).toBe(`https://bcdn.renthub.in.th${path}`);
  });

  it("builds the public listing URL", () => {
    expect(listingUrl("natee-place--3")).toBe("https://www.renthub.in.th/en/natee-place--3");
  });
});
