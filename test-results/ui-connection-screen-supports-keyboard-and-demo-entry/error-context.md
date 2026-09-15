# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui.spec.js >> connection screen supports keyboard and demo entry
- Location: tests\ui.spec.js:27:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('navigation')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('navigation') with timeout 5000ms
  - waiting for getByRole('navigation')

```

```yaml
- text: N NOVATV A BETTER WAY TO WATCH
- heading "Your world. On play." [level=1]
- paragraph: Live moments. Great stories. One place for everything you love.
- img
- text: Built for the big screen
- img
- text: Your own subscription MORE TO DISCOVER. EVERY DAY.
- main:
  - text: WELCOME TO NOVA
  - heading "Make yourself at home." [level=2]
  - paragraph: Connect your IPTV playlist to start watching.
  - text: Playlist name
  - textbox "Playlist name": My playlist
  - text: Provider URL
  - textbox "Provider URL":
    - /placeholder: https://your-provider.com
  - text: Username
  - textbox "Username"
  - text: Password
  - textbox "Password"
  - alert: The request could not be completed. Please try again.
  - button "Connect playlist":
    - text: Connect playlist
    - img
  - text: JUST LOOKING AROUND?
  - button "Explore demo":
    - text: Explore demo
    - img
  - paragraph: Demo includes sample content. NOVA does not supply a TV subscription.
  - group: Backend connection settings
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | test("failed movie load never shows the previous live channel list", async ({
  4   |   page,
  5   | }) => {
  6   |   await page.goto("/");
  7   |   await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  8   |   await page.getByRole("button", { name: "Live TV", exact: true }).click();
  9   |   await expect(
  10  |     page.getByRole("button", { name: "Open Open Cinema", exact: true }),
  11  |   ).toBeVisible();
  12  |   await page.route("**/api/catalog/movie?**", (route) =>
  13  |     route.fulfill({
  14  |       status: 502,
  15  |       json: { error: "Movie catalog unavailable" },
  16  |     }),
  17  |   );
  18  |   await page.getByRole("button", { name: "Movies", exact: true }).click();
  19  |   await expect(page.getByRole("alert")).toContainText(
  20  |     "Movie catalog unavailable",
  21  |   );
  22  |   await expect(
  23  |     page.getByRole("button", { name: "Open Open Cinema", exact: true }),
  24  |   ).toHaveCount(0);
  25  |   await expect(page.locator(".count")).toContainText("0 titles");
  26  | });
  27  | test("connection screen supports keyboard and demo entry", async ({ page }) => {
  28  |   await page.goto("/");
  29  |   await expect(
  30  |     page.getByRole("heading", { name: "Your world. On play." }),
  31  |   ).toBeVisible();
  32  |   await expect(page.getByLabel("Provider URL")).toBeVisible();
  33  |   await page.getByRole("button", { name: "Explore demo" }).focus();
  34  |   await page.keyboard.press("Enter");
> 35  |   await expect(page.getByRole("navigation")).toBeVisible();
      |                                              ^ Error: expect(locator).toBeVisible() failed
  36  |   await page.getByRole("button", { name: "Movies", exact: true }).click();
  37  |   await expect(
  38  |     page.getByRole("heading", { name: "Movies", exact: true }),
  39  |   ).toBeVisible();
  40  |   await page.getByLabel("Search library").fill("Bunny");
  41  |   await expect(
  42  |     page.getByRole("button", { name: "Open Big Buck Bunny", exact: true }),
  43  |   ).toBeVisible();
  44  |   await page
  45  |     .getByRole("button", { name: "Open Big Buck Bunny", exact: true })
  46  |     .click();
  47  |   await page.getByRole("button", { name: "Add to favorites" }).click();
  48  |   await expect(
  49  |     page.getByRole("button", { name: "Remove from favorites" }),
  50  |   ).toBeVisible();
  51  |   await page.keyboard.press("Escape");
  52  |   await page.getByRole("button", { name: "Favorites", exact: true }).click();
  53  |   await expect(
  54  |     page.getByRole("button", { name: "Open Big Buck Bunny", exact: true }),
  55  |   ).toBeVisible();
  56  |   await page.reload();
  57  |   await expect(page.getByRole("navigation")).toBeVisible();
  58  |   await page.getByRole("button", { name: "Series", exact: true }).click();
  59  |   await page
  60  |     .getByRole("button", { name: "Open The Open Movie Collection" })
  61  |     .click();
  62  |   await page.getByLabel("Season", { exact: true }).focus();
  63  |   await page.keyboard.press("ArrowDown");
  64  |   await expect(page.getByLabel("Season", { exact: true })).toHaveValue("2");
  65  |   const episode = page.locator(".episode").first();
  66  |   await expect(episode).toBeVisible();
  67  |   await episode.click();
  68  |   await expect(page.getByRole("dialog", { name: /Playing/ })).toBeVisible();
  69  |   await page.getByRole("button", { name: "Close player" }).click();
  70  |   await expect(
  71  |     page.getByRole("dialog", { name: "The Open Movie Collection" }),
  72  |   ).toBeVisible();
  73  |   await page.keyboard.press("Escape");
  74  |   await page.getByRole("button", { name: "Live TV", exact: true }).focus();
  75  |   await page.keyboard.press("ArrowDown");
  76  |   await expect(
  77  |     page.getByRole("button", { name: "Movies", exact: true }),
  78  |   ).toBeFocused();
  79  |   await page.keyboard.press("Enter");
  80  |   await expect(
  81  |     page.getByRole("heading", { name: "Movies", exact: true }),
  82  |   ).toBeVisible();
  83  | });
  84  | 
  85  | test("favorites navigation clears pending catalog loading", async ({
  86  |   page,
  87  | }) => {
  88  |   await page.route("**/api/catalog/**", async (route) => {
  89  |     await new Promise((resolve) => setTimeout(resolve, 800));
  90  |     await route
  91  |       .fulfill({
  92  |         json: { items: [], categories: [], total: 0, page: 1, pages: 1 },
  93  |       })
  94  |       .catch(() => {});
  95  |   });
  96  |   await page.goto("/");
  97  |   await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  98  |   await page.getByRole("button", { name: "Favorites", exact: true }).click();
  99  |   await expect(
  100 |     page.getByText("Your favorites start here.", { exact: true }),
  101 |   ).toBeVisible();
  102 | });
  103 | 
  104 | test("movie playback uses the extension resolved by title details", async ({
  105 |   page,
  106 | }) => {
  107 |   await page.route("**/api/details/movie/1", async (route) => {
  108 |     const response = await route.fetch();
  109 |     const data = await response.json();
  110 |     data.item.extension = "mkv";
  111 |     data.plot = "Verified movie metadata.";
  112 |     await route.fulfill({ json: data });
  113 |   });
  114 |   await page.goto("/");
  115 |   await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  116 |   await page.getByRole("button", { name: "Movies", exact: true }).click();
  117 |   await page
  118 |     .getByRole("button", { name: "Open Big Buck Bunny", exact: true })
  119 |     .click();
  120 |   await expect(
  121 |     page.getByText("Verified movie metadata.", { exact: true }),
  122 |   ).toBeVisible();
  123 |   const requested = page.waitForRequest((r) => r.url().endsWith("/api/play"));
  124 |   await page.getByRole("button", { name: "Play now", exact: true }).click();
  125 |   expect((await requested).postDataJSON().extension).toBe("mkv");
  126 | });
  127 | test("mobile connection remains within viewport and exposes server setup", async ({
  128 |   page,
  129 | }) => {
  130 |   await page.setViewportSize({ width: 390, height: 844 });
  131 |   await page.goto("/");
  132 |   await expect(
  133 |     page.getByRole("button", { name: "Explore demo" }),
  134 |   ).toBeVisible();
  135 |   expect(
```