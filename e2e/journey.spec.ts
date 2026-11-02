import { test, expect, type Browser, type Page } from "@playwright/test";

const SHOTS = "e2e/screenshots";

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(1);
}

async function newUser(browser: Browser, mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}

async function fillSurvey(page: Page, o: { name: string; size: number; ideal: string; max: string; top: string }) {
  await page.getByRole("textbox", { name: /party name/i }).fill(o.name);
  if (o.size === 2) await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByTestId("survey-next").click();
  await page.locator('input[name="ideal"]').fill(o.ideal);
  await page.locator('input[name="max"]').fill(o.max);
  await page.getByTestId("survey-next").click();
  await page.getByRole("button", { name: new RegExp(o.top) }).click();
  await page.getByTestId("survey-next").click();
  await page.getByTestId("survey-next").click();
}

test("demo: every persona sees an authorized view; approvals finalize the fixture", async ({ browser }) => {
  // Fresh demo
  const admin = await newUser(browser);
  await admin.page.goto("/demo");
  await admin.page.getByRole("button", { name: "Reset demo data" }).click();
  await admin.page.getByRole("button", { name: "Confirm" }).click();
  await expect(admin.page.getByText("Demo reset")).toBeVisible();
  await admin.page.screenshot({ path: `${SHOTS}/desktop-demo.png`, fullPage: true, animations: "disabled" });

  const personas = ["organizer", "a1", "a2", "b1", "b2", "c1", "d1"];
  const sessions: Record<string, Page> = {};
  for (const key of personas) {
    const u = await newUser(browser);
    await u.page.goto(`/demo/as/${key}`);
    await u.page.waitForLoadState("networkidle");
    sessions[key] = u.page;
    await u.page.screenshot({ path: `${SHOTS}/desktop-persona-${key}.png`, fullPage: true, animations: "disabled" });
    await noHorizontalOverflow(u.page);
    expect(u.errors).toEqual([]);
  }
  // Organizer dashboard
  await expect(sessions.organizer.getByText("Organizer dashboard")).toBeVisible();
  // Second member of Party A sees party, room, full price and own share, cannot vote
  const a2 = sessions.a2;
  await expect(a2.getByTestId("my-room")).toHaveText("Master Suite");
  await expect(a2.getByTestId("my-total")).toHaveText("$1,409.77");
  await expect(a2.getByTestId("my-share")).toHaveText("$704.88");
  await expect(a2.getByText(/votes for your party/)).toBeVisible();

  // Results reconcile to the fixture
  const res = sessions.c1;
  await res.goto(res.url().replace(/\/party\/.*/, "") + "/demo");
  const gid = await sessions.organizer.url().split("/group/")[1];
  await res.goto(`/results/${gid}`);
  await expect(res.getByTestId("price-Master Suite")).toHaveText("$1,409.77");
  await expect(res.getByTestId("price-View Room")).toHaveText("$1,233.95");
  await expect(res.getByTestId("price-Comfort Room")).toHaveText("$924.65");
  await expect(res.getByTestId("price-Twin/Bunk Room")).toHaveText("$631.63");
  await expect(res.getByTestId("total-reconciled")).toHaveText("$4,200.00");
  await res.screenshot({ path: `${SHOTS}/desktop-results.png`, fullPage: true, animations: "disabled" });

  // Two representatives vote at the same time (separate browser contexts)
  const b1 = sessions.b1;
  const d1 = sessions.d1;
  await Promise.all([b1.goto(`/results/${gid}`), d1.goto(`/results/${gid}`)]);
  await Promise.all([b1.getByTestId("approve").click(), d1.getByTestId("approve").click()]);
  await expect(b1.getByTestId("approve")).toHaveText(/Approved/);
  await expect(d1.getByTestId("approve")).toHaveText(/Approved/);

  // Organizer's live view picks up the change without reload, then finalizes
  const org = sessions.organizer;
  await expect(org.getByTestId("finalize")).toBeVisible({ timeout: 15_000 });
  await org.getByTestId("finalize").click();
  await org.waitForURL(/agreement/);
  await expect(org.getByTestId("agreement-table")).toContainText("$4,200.00");
  await org.screenshot({ path: `${SHOTS}/desktop-agreement.png`, fullPage: true, animations: "disabled" });

  // A member sees the final agreement too
  await a2.reload();
  await expect(a2.getByText("Agreement finalized")).toBeVisible();
});

test("new organizer → invite → two members join one party independently → cap → surveys → optimize → vote → finalize", async ({ browser }) => {
  const org = await newUser(browser);
  await org.page.goto("/");
  await org.page.getByRole("link", { name: "Start a group" }).first().click();
  await org.page.locator('input[name="organizerName"]').fill("Olivia Park");
  await org.page.locator('input[name="groupName"]').fill("Lake weekend");
  await org.page.locator('input[name="partyCount"]').fill("2");
  await org.page.getByTestId("create-submit").click();
  await org.page.waitForURL(/\/property$/);
  await org.page.screenshot({ path: `${SHOTS}/desktop-property.png`, fullPage: true, animations: "disabled" });
  await org.page.getByTestId("start-collecting").click();
  await org.page.waitForURL(/\/invites$/);
  const gid = org.page.url().split("/group/")[1].split("/")[0];
  await org.page.getByTestId("create-invite-Party B").click();
  const link = (await org.page.getByTestId("invite-Party B").textContent())!.trim();
  await org.page.screenshot({ path: `${SHOTS}/desktop-invites.png`, fullPage: true, animations: "disabled" });

  // Two people join Party B from separate browsers
  const ben = await newUser(browser);
  await ben.page.goto(link);
  await ben.page.locator('input[name="displayName"]').fill("Ben Ito");
  await ben.page.getByTestId("join-submit").click();
  await ben.page.waitForURL(/onboarding/);
  const cara = await newUser(browser, true);
  await cara.page.goto(link);
  await cara.page.locator('input[name="displayName"]').fill("Cara Ito");
  await cara.page.getByTestId("join-submit").click();
  await cara.page.waitForURL(/onboarding/);
  await cara.page.screenshot({ path: `${SHOTS}/mobile-onboarding.png`, fullPage: true, animations: "disabled" });
  await noHorizontalOverflow(cara.page);

  // Third person is refused (cap of 2)
  const dan = await newUser(browser);
  await dan.page.goto(link);
  await dan.page.locator('input[name="displayName"]').fill("Dan");
  await dan.page.getByTestId("join-submit").click();
  await expect(dan.page.getByText(/is full \(maximum 2/)).toBeVisible();

  // Organizer survey (Party A, solo)
  await org.page.goto(`/group/${gid}`);
  await org.page.getByRole("link", { name: "My party" }).first().click();
  await org.page.getByRole("link", { name: /questionnaire/i }).first().click();
  await fillSurvey(org.page, { name: "Olivia", size: 1, ideal: "2000", max: "2600", top: "Privacy" });
  await org.page.screenshot({ path: `${SHOTS}/desktop-survey-review.png`, fullPage: true, animations: "disabled" });
  await org.page.getByTestId("survey-submit").click();
  await org.page.waitForURL(/submitted=1/);

  // Ben (representative) submits for Party B; data persists across reload
  await ben.page.getByRole("link", { name: "Start the questionnaire" }).click();
  await ben.page.getByRole("textbox", { name: /party name/i }).fill("The Itos");
  await ben.page.waitForTimeout(1200);
  await ben.page.reload();
  await expect(ben.page.getByRole("textbox", { name: /party name/i })).toHaveValue("The Itos");
  await fillSurvey(ben.page, { name: "The Itos", size: 2, ideal: "1800", max: "2200", top: "Lowest possible price" });
  await ben.page.getByTestId("survey-submit").click();
  await ben.page.waitForURL(/submitted=1/);

  // Cara (non-rep, mobile) cannot submit, only share
  await cara.page.getByRole("link", { name: "Start the questionnaire" }).click();
  await expect(cara.page.getByText("Your input, not the final answer")).toBeVisible();
  await cara.page.screenshot({ path: `${SHOTS}/mobile-survey.png`, fullPage: true, animations: "disabled" });
  await noHorizontalOverflow(cara.page);

  // Optimize
  await org.page.goto(`/group/${gid}/optimize`);
  await org.page.getByTestId("run-optimizer").click();
  await org.page.waitForURL(/\/results\//, { timeout: 30_000 });
  await expect(org.page.getByTestId("total-reconciled")).toHaveText("$4,200.00");
  await org.page.getByTestId("open-voting").click();
  await expect(org.page.getByTestId("approve")).toBeVisible();
  await org.page.getByTestId("approve").click();

  // Ben requests changes, then approves
  await ben.page.goto(`/results/${gid}`);
  await ben.page.getByTestId("request-changes").click();
  await ben.page.getByTestId("changes-comment").fill("Could we try 50/50 shared?");
  await ben.page.getByTestId("submit-changes").click();
  await expect(ben.page.getByText("Changes requested")).toBeVisible();
  await ben.page.getByTestId("approve").click();
  await expect(ben.page.getByTestId("approve")).toHaveText(/Approved/);

  // Cara on mobile: sees results, no vote button, no overflow
  await cara.page.goto(`/results/${gid}`);
  await expect(cara.page.getByTestId("approve")).toHaveCount(0);
  await cara.page.screenshot({ path: `${SHOTS}/mobile-results.png`, fullPage: true, animations: "disabled" });
  await noHorizontalOverflow(cara.page);

  // Material change invalidates approvals
  await org.page.goto(`/group/${gid}/property`);
  await org.page.getByLabel("Shared percentage").fill("50");
  await org.page.getByTestId("save-pricing").click();
  await expect(org.page.getByText("Saved").first()).toBeVisible();
  await org.page.goto(`/results/${gid}`);
  await expect(org.page.getByText("This proposal is out of date")).toBeVisible();

  // Re-run and finalize
  await org.page.goto(`/group/${gid}/optimize`);
  await org.page.getByTestId("run-optimizer").click();
  await org.page.waitForURL(/\/results\//, { timeout: 30_000 });
  await org.page.getByTestId("open-voting").click();
  await org.page.getByTestId("approve").click();
  await ben.page.goto(`/results/${gid}`);
  await ben.page.getByTestId("approve").click();
  await org.page.goto(`/group/${gid}`);
  await org.page.getByTestId("finalize").click();
  await org.page.waitForURL(/agreement/);
  await expect(org.page.getByTestId("agreement-table")).toBeVisible();

  // Outsider can't see the group
  // Signed-out visitor is sent to sign in; a signed-in outsider (another group's user) gets a 404
  await dan.page.goto(`/results/${gid}`);
  await expect(dan.page).toHaveURL(/signin/);
  await dan.page.goto("/demo/as/d1");
  await dan.page.goto(`/results/${gid}`);
  await expect(dan.page.getByText(/Nothing here/)).toBeVisible();
  await expect(dan.page.getByTestId("total-reconciled")).toHaveCount(0);
  for (const u of [org, ben, cara]) expect(u.errors).toEqual([]);
});

test("auction mode: bids → market proposal and price-discovery page", async ({ browser }) => {
  const admin = await newUser(browser);
  await admin.page.goto("/demo");
  await admin.page.getByRole("button", { name: "Reset demo data" }).click();
  await admin.page.getByRole("button", { name: "Confirm" }).click();
  await expect(admin.page.getByText("Demo reset")).toBeVisible();
  const org = await newUser(browser);
  await org.page.goto("/demo/as/organizer");
  const gid = org.page.url().split("/group/")[1];
  await org.page.goto(`/group/${gid}/property`);
  await org.page.getByText("Weighted + auction comparison").click();
  await org.page.getByTestId("save-pricing").click();
  await expect(org.page.getByText("Saved").first()).toBeVisible();
  await org.page.goto(`/group/${gid}/optimize`);
  await org.page.getByTestId("run-optimizer").click();
  await org.page.waitForURL(/\/results\//, { timeout: 30_000 });
  await org.page.goto(`/results/${gid}/compare`);
  await expect(org.page.getByText("Market auction").first()).toBeVisible();
  await org.page.screenshot({ path: `${SHOTS}/desktop-compare-auction.png`, fullPage: true, animations: "disabled" });
  await org.page.goto(`/results/${gid}/market`);
  await expect(org.page.getByText(/Cleared/)).toBeVisible();
  await org.page.screenshot({ path: `${SHOTS}/desktop-market.png`, fullPage: true, animations: "disabled" });
  // A party member sees its own private result but no raw bids of others
  const lena = await newUser(browser, true);
  await lena.page.goto("/demo/as/c1");
  await lena.page.goto(`/results/${gid}/market`);
  await expect(lena.page.getByText("Your result (private)")).toBeVisible();
  await expect(lena.page.getByText("Top / second bid")).toHaveCount(0);
  await lena.page.screenshot({ path: `${SHOTS}/mobile-market.png`, fullPage: true, animations: "disabled" });
  await noHorizontalOverflow(lena.page);
});

test("mobile pass over key screens", async ({ browser }) => {
  const u = await newUser(browser, true);
  await u.page.goto("/");
  await u.page.screenshot({ path: `${SHOTS}/mobile-welcome.png`, fullPage: true, animations: "disabled" });
  await noHorizontalOverflow(u.page);
  await u.page.goto("/demo/as/b1");
  const pid = u.page.url().split("/party/")[1];
  await u.page.screenshot({ path: `${SHOTS}/mobile-party.png`, fullPage: true, animations: "disabled" });
  await noHorizontalOverflow(u.page);
  await u.page.goto(`/survey/${pid}`);
  await noHorizontalOverflow(u.page);
  await u.page.goto("/demo");
  await noHorizontalOverflow(u.page);
  expect(u.errors).toEqual([]);
});
