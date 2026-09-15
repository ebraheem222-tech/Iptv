# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: player-controls.spec.js >> player exposes seek, volume, captions, and fullscreen controls
- Location: tests\player-controls.spec.js:19:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Movies', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]: "N"
      - generic [ref=e7]: NOVATV
    - generic [ref=e8]:
      - generic [ref=e9]: A BETTER WAY TO WATCH
      - heading "Your world. On play." [level=1] [ref=e10]: Your world.On play.
      - paragraph [ref=e11]: Live moments. Great stories.One place for everything you love.
      - generic [ref=e12]:
        - generic [ref=e13]: Built for the big screen
        - generic [ref=e16]: Your own subscription
    - generic [ref=e18]: MORE TO DISCOVER. EVERY DAY.
  - main [ref=e19]:
    - generic [ref=e20]: WELCOME TO NOVA
    - heading "Make yourself at home." [level=2] [ref=e21]
    - paragraph [ref=e22]: Connect your IPTV playlist to start watching.
    - generic [ref=e23]:
      - generic [ref=e24]:
        - text: Playlist name
        - textbox "Playlist name" [ref=e25]: My playlist
      - generic [ref=e26]:
        - text: Provider URL
        - textbox "Provider URL" [ref=e27]:
          - /placeholder: https://your-provider.com
      - generic [ref=e28]:
        - text: Username
        - textbox "Username" [ref=e29]
      - generic [ref=e30]:
        - text: Password
        - textbox "Password" [ref=e31]
      - alert [ref=e32]: The request could not be completed. Please try again.
      - button "Connect playlist" [ref=e33] [cursor=pointer]
    - generic [ref=e36]: JUST LOOKING AROUND?
    - button "Explore demo" [ref=e38] [cursor=pointer]
    - paragraph [ref=e41]: Demo includes sample content. NOVA does not supply a TV subscription.
    - group [ref=e42]:
      - generic "Backend connection settings" [ref=e43] [cursor=pointer]
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | async function openDemoMovie(page) {
  4   |   await page.goto("/");
  5   |   await page
  6   |     .getByRole("button", { name: "Explore demo", exact: true })
  7   |     .click();
> 8   |   await page.getByRole("button", { name: "Movies", exact: true }).click();
      |                                                                   ^ Error: locator.click: Test timeout of 30000ms exceeded.
  9   |   await page
  10  |     .getByRole("button", { name: "Open Big Buck Bunny", exact: true })
  11  |     .click();
  12  |   await page
  13  |     .getByRole("button", { name: "Play now", exact: true })
  14  |     .click();
  15  | 
  16  |   await expect(page.getByRole("dialog", { name: /Playing/ })).toBeVisible();
  17  | }
  18  | 
  19  | test("player exposes seek, volume, captions, and fullscreen controls", async ({
  20  |   page,
  21  | }) => {
  22  |   await openDemoMovie(page);
  23  | 
  24  |   await expect(page.getByLabel("Seek", { exact: true })).toBeVisible();
  25  |   await expect(page.getByLabel("Volume", { exact: true })).toBeVisible();
  26  | 
  27  |   await expect(
  28  |     page.getByRole("button", { name: /fullscreen/i }),
  29  |   ).toBeVisible();
  30  | 
  31  |   const captions = page.locator(
  32  |     'button[aria-label^="No captions"], button[aria-label^="Captions"]',
  33  |   );
  34  | 
  35  |   await expect(captions).toHaveCount(1);
  36  | 
  37  |   await page.getByLabel("Volume", { exact: true }).fill("0.35");
  38  | 
  39  |   await expect(
  40  |     page.getByText("35%", { exact: true }),
  41  |   ).toBeVisible();
  42  | 
  43  |   await page
  44  |     .getByRole("button", { name: "Mute", exact: true })
  45  |     .click();
  46  | 
  47  |   await expect(
  48  |     page.getByRole("button", { name: "Unmute", exact: true }),
  49  |   ).toBeVisible();
  50  | });
  51  | 
  52  | test("live player keeps transport semantics live-only", async ({ page }) => {
  53  |   await page.goto("/");
  54  | 
  55  |   await page
  56  |     .getByRole("button", { name: "Explore demo", exact: true })
  57  |     .click();
  58  | 
  59  |   await page
  60  |     .getByRole("button", { name: "Live TV", exact: true })
  61  |     .click();
  62  | 
  63  |   await page
  64  |     .getByRole("button", {
  65  |       name: "Open Open Cinema",
  66  |       exact: true,
  67  |     })
  68  |     .click();
  69  | 
  70  |   await page
  71  |     .getByRole("button", {
  72  |       name: "Watch live",
  73  |       exact: true,
  74  |     })
  75  |     .click();
  76  | 
  77  |   await expect(
  78  |     page.getByRole("dialog", { name: /Playing/ }),
  79  |   ).toBeVisible();
  80  | 
  81  |   await expect(
  82  |     page.getByText(/duration is controlled by the channel/i),
  83  |   ).toBeVisible();
  84  | 
  85  |   await expect(
  86  |     page.getByLabel("Seek", { exact: true }),
  87  |   ).toHaveCount(0);
  88  | 
  89  |   await expect(
  90  |     page.getByRole("button", {
  91  |       name: "Rewind 10 seconds",
  92  |     }),
  93  |   ).toBeDisabled();
  94  | 
  95  |   await expect(
  96  |     page.getByRole("button", {
  97  |       name: "Forward 10 seconds",
  98  |     }),
  99  |   ).toBeDisabled();
  100 | });
  101 | 
  102 | test("Arabic provider captions are selected, listed, and can be turned off", async ({
  103 |   page,
  104 | }) => {
  105 |   await page.route("**/api/play", async (route) => {
  106 |     const response = await route.fetch();
  107 |     const data = await response.json();
  108 |     await route.fulfill({
```