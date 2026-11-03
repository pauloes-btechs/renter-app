import { test, expect } from "@playwright/test";

// 2x2 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");

test("organizer imports bedrooms from listing photos + text, reviews, applies", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await admin.goto("/demo");
  await admin.getByRole("button", { name: "Reset demo data" }).click();
  await admin.getByRole("button", { name: "Confirm" }).click();
  await expect(admin.getByText("Demo reset")).toBeVisible();

  const page = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/demo/as/organizer");
  const gid = page.url().split("/group/")[1];
  await page.goto(`/group/${gid}/property`);
  await page.getByTestId("open-import").click();
  await page.getByLabel("Listing link").fill("https://www.airbnb.com/rooms/12345");
  await page.getByTestId("import-files").setInputFiles(
    Array.from({ length: 5 }, (_, i) => ({ name: `room-${i}.png`, mimeType: "image/png", buffer: PNG })),
  );
  await expect(page.getByAltText("Photo 4")).toBeVisible();
  await page.getByTestId("import-text").fill(
    "Where you'll sleep\nBedroom 1: 1 king bed, ensuite\nBedroom 2: 1 queen bed\nBedroom 3: 1 queen bed\nBunk room: 1 bunk bed\nWhat this place offers\nAir conditioning\nWifi\nHot tub",
  );
  await page.getByTestId("analyze-listing").click();
  await expect(page.getByTestId("import-room")).toHaveCount(4);
  await expect(page.getByText("Best view", { exact: true })).toBeVisible();
  await expect(page.getByTestId("import-shared")).toHaveValue(/Air conditioning/);
  await page.screenshot({ path: "e2e/screenshots/desktop-listing-import-review.png", fullPage: true, animations: "disabled" });
  await page.getByRole("textbox", { name: "Room name" }).first().fill("Cliffside primary suite");
  await page.getByTestId("apply-import").click();
  await expect(page.getByText("4 bedrooms imported.")).toBeVisible();
  await expect(page.getByText("Cliffside primary suite").first()).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/desktop-property-after-import.png", fullPage: true, animations: "disabled" });

  // Parties must re-rank: dashboard shows questionnaires reopened, results show no current proposal
  await page.goto(`/group/${gid}`);
  await expect(page.getByText("Waiting on 4 parties")).toBeVisible();
  expect(errors).toEqual([]);
});

test("new group starts from a listing link: Airbnb asks for paste, then everything is prefilled", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/create");
  await page.locator('input[name="listingUrl"]').fill("https://www.airbnb.com/rooms/987");
  await page.getByTestId("analyze-create").click();
  await expect(page.getByText(/Airbnb doesn't allow automated reading/)).toBeVisible();
  await page.getByTestId("create-paste").fill(
    [
      "Cliffside Retreat with Hot Tub",
      "Big Sur, California",
      "$450 x 4 nights $1,800",
      "Cleaning fee $250",
      "Service fee $300",
      "Taxes $150",
      "Total $2,500",
      "Where you'll sleep",
      "Bedroom 1: 1 king bed",
      "Bedroom 2: 1 queen bed",
      "Bedroom 3: 2 twin beds",
      "What this place offers",
      "Air conditioning",
      "Wifi",
    ].join("\n"),
  );
  await page.getByTestId("create-files").setInputFiles(Array.from({ length: 3 }, (_, i) => ({ name: `r${i}.png`, mimeType: "image/png", buffer: PNG })));
  await page.getByTestId("analyze-create").click();
  await expect(page.getByText("Imported from the listing")).toBeVisible();
  await expect(page.locator('input[name="propertyName"]')).toHaveValue("Cliffside Retreat with Hot Tub");
  await expect(page.locator('input[name="location"]')).toHaveValue("Big Sur, California");
  await expect(page.getByTestId("create-total")).toHaveText("$2,500.00");
  await expect(page.getByTestId("create-room")).toHaveCount(3);
  await expect(page.locator('input[name="partyCount"]')).toHaveValue("3");
  await page.screenshot({ path: "e2e/screenshots/desktop-create-from-listing.png", fullPage: true, animations: "disabled" });
  await page.locator('input[name="organizerName"]').fill("Lia Moreno");
  await page.getByTestId("create-submit").click();
  await page.waitForURL(/\/property$/);
  await expect(page.getByRole("heading", { name: "Cliffside Retreat with Hot Tub" })).toBeVisible();
  await expect(page.getByText("$2,500.00").first()).toBeVisible();
  await expect(page.getByText("Primary suite").first()).toBeVisible();
  expect(errors).toEqual([]);
});
