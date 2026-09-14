import { test, expect } from "@playwright/test";

test("failed movie load never shows the previous live channel list", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("button", { name: "Live TV", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Open Cinema", exact: true }),
  ).toBeVisible();
  await page.route("**/api/catalog/movie?**", (route) =>
    route.fulfill({
      status: 502,
      json: { error: "Movie catalog unavailable" },
    }),
  );
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Movie catalog unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Open Open Cinema", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".count")).toContainText("0 titles");
});
test("connection screen supports keyboard and demo entry", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your world. On play." }),
  ).toBeVisible();
  await expect(page.getByLabel("Provider URL")).toBeVisible();
  await page.getByRole("button", { name: "Explore demo" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Movies", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search library").fill("Bunny");
  await expect(
    page.getByRole("button", { name: "Open Big Buck Bunny", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open Big Buck Bunny", exact: true })
    .click();
  await page.getByRole("button", { name: "Add to favorites" }).click();
  await expect(
    page.getByRole("button", { name: "Remove from favorites" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Big Buck Bunny", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.getByRole("button", { name: "Series", exact: true }).click();
  await page
    .getByRole("button", { name: "Open The Open Movie Collection" })
    .click();
  await page.getByLabel("Season", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByLabel("Season", { exact: true })).toHaveValue("2");
  const episode = page.locator(".episode").first();
  await expect(episode).toBeVisible();
  await episode.click();
  await expect(page.getByRole("dialog", { name: /Playing/ })).toBeVisible();
  await page.getByRole("button", { name: "Close player" }).click();
  await expect(
    page.getByRole("dialog", { name: "The Open Movie Collection" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Live TV", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "Movies", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Movies", exact: true }),
  ).toBeVisible();
});

test("favorites navigation clears pending catalog loading", async ({
  page,
}) => {
  await page.route("**/api/catalog/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route
      .fulfill({
        json: { items: [], categories: [], total: 0, page: 1, pages: 1 },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(
    page.getByText("Your favorites start here.", { exact: true }),
  ).toBeVisible();
});

test("movie playback uses the extension resolved by title details", async ({
  page,
}) => {
  await page.route("**/api/details/movie/1", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.item.extension = "mkv";
    data.plot = "Verified movie metadata.";
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Big Buck Bunny", exact: true })
    .click();
  await expect(
    page.getByText("Verified movie metadata.", { exact: true }),
  ).toBeVisible();
  const requested = page.waitForRequest((r) => r.url().endsWith("/api/play"));
  await page.getByRole("button", { name: "Play now", exact: true }).click();
  expect((await requested).postDataJSON().extension).toBe("mkv");
});
test("mobile connection remains within viewport and exposes server setup", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Explore demo" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Explore demo" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByText("Backend connection settings", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Backend URL", { exact: true })).toBeVisible();
});
test("Samsung media keys are idempotent and player cleanup restores screensaver", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.avState = "NONE";
    window.screensaver = 1;
    window.webapis = {
      appcommon: { setScreenSaver: (n) => (window.screensaver = n) },
      avplay: {
        open: () => (window.avState = "IDLE"),
        setDisplayRect: () => {},
        setDisplayMethod: () => {},
        setListener: () => {},
        prepareAsync: (cb) => {
          window.avState = "READY";
          setTimeout(cb, 0);
        },
        play: () => (window.avState = "PLAYING"),
        pause: () => (window.avState = "PAUSED"),
        stop: () => (window.avState = "IDLE"),
        close: () => (window.avState = "NONE"),
        getState: () => window.avState,
        getDuration: () => 60000,
        getCurrentTime: () => 1000,
        seekTo: () => {},
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Big Buck Bunny", exact: true })
    .click();
  await page.getByRole("button", { name: "Play now", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.avState)).toBe("PLAYING");
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { keyCode: 415, bubbles: true }),
    ),
  );
  expect(await page.evaluate(() => window.avState)).toBe("PLAYING");
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { keyCode: 19, bubbles: true }),
    ),
  );
  expect(
    await page.evaluate(() => [window.avState, window.screensaver]),
  ).toEqual(["PAUSED", 1]);
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { keyCode: 19, bubbles: true }),
    ),
  );
  expect(await page.evaluate(() => window.avState)).toBe("PAUSED");
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
    ),
  );
  await expect(page.getByRole("dialog", { name: /Playing/ })).toHaveCount(0);
  expect(
    await page.evaluate(() => [window.avState, window.screensaver]),
  ).toEqual(["NONE", 1]);
});
