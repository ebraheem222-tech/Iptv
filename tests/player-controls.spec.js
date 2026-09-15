import { test, expect } from "@playwright/test";

async function openDemoMovie(page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore demo", exact: true })
    .click();
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Big Buck Bunny", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Play now", exact: true })
    .click();

  await expect(page.getByRole("dialog", { name: /Playing/ })).toBeVisible();
}

test("player exposes seek, volume, captions, and fullscreen controls", async ({
  page,
}) => {
  await openDemoMovie(page);

  await expect(page.getByLabel("Seek", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Volume", { exact: true })).toBeVisible();

  await expect(
    page.getByRole("button", { name: /fullscreen/i }),
  ).toBeVisible();

  const captions = page.locator(
    'button[aria-label^="No captions"], button[aria-label^="Captions"]',
  );

  await expect(captions).toHaveCount(1);

  await page.getByLabel("Volume", { exact: true }).fill("0.35");

  await expect(
    page.getByText("35%", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Mute", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Unmute", exact: true }),
  ).toBeVisible();
});

test("live player keeps transport semantics live-only", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("button", { name: "Explore demo", exact: true })
    .click();

  await page
    .getByRole("button", { name: "Live TV", exact: true })
    .click();

  await page
    .getByRole("button", {
      name: "Open Open Cinema",
      exact: true,
    })
    .click();

  await page
    .getByRole("button", {
      name: "Watch live",
      exact: true,
    })
    .click();

  await expect(
    page.getByRole("dialog", { name: /Playing/ }),
  ).toBeVisible();

  await expect(
    page.getByText(/duration is controlled by the channel/i),
  ).toBeVisible();

  await expect(
    page.getByLabel("Seek", { exact: true }),
  ).toHaveCount(0);

  await expect(
    page.getByRole("button", {
      name: "Rewind 10 seconds",
    }),
  ).toBeDisabled();

  await expect(
    page.getByRole("button", {
      name: "Forward 10 seconds",
    }),
  ).toBeDisabled();
});

test("Arabic provider captions are selected, listed, and can be turned off", async ({
  page,
}) => {
  await page.route("**/api/play", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, captionsUrl: "/api/captions/test-ticket" },
    });
  });
  await page.route("**/api/captions/test-ticket", (route) =>
    route.fulfill({
      json: {
        tracks: [
          {
            id: "english-caption-1",
            language: "eng",
            label: "English",
            title: "English",
            default: false,
            forced: false,
          },
          {
            id: "arabic-caption-1",
            language: "ara",
            label: "Arabic",
            title: "Arabic",
            default: true,
            forced: false,
          },
        ],
      },
    }),
  );
  await page.route(
    "**/api/captions/test-ticket/arabic-caption-1.vtt",
    (route) =>
      route.fulfill({
        contentType: "text/vtt",
        body: "WEBVTT\n\n00:00:00.000 --> 00:10:00.000\nمرحبا بكم\n",
      }),
  );

  await openDemoMovie(page);

  await expect(page.getByTestId("caption-overlay")).toHaveText("مرحبا بكم");
  await page.getByRole("button", { name: "Captions: العربية" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "العربية" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("menuitemradio", { name: "English" }),
  ).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Off" }).click();
  await expect(page.getByTestId("caption-overlay")).toHaveCount(0);
});
