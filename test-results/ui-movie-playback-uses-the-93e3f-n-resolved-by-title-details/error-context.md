# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui.spec.js >> movie playback uses the extension resolved by title details
- Location: tests\ui.spec.js:104:1

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
  35  |   await expect(page.getByRole("navigation")).toBeVisible();
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
> 116 |   await page.getByRole("button", { name: "Movies", exact: true }).click();
      |                                                                   ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  136 |     await page.evaluate(() => document.documentElement.scrollWidth),
  137 |   ).toBeLessThanOrEqual(390);
  138 |   await page.getByRole("button", { name: "Explore demo" }).focus();
  139 |   await page.keyboard.press("ArrowDown");
  140 |   await expect(
  141 |     page.getByText("Backend connection settings", { exact: true }),
  142 |   ).toBeFocused();
  143 |   await page.keyboard.press("Enter");
  144 |   await expect(page.getByLabel("Backend URL", { exact: true })).toBeVisible();
  145 | });
  146 | test("Samsung media keys are idempotent and player cleanup restores screensaver", async ({
  147 |   page,
  148 | }) => {
  149 |   await page.addInitScript(() => {
  150 |     window.avState = "NONE";
  151 |     window.screensaver = 1;
  152 |     window.webapis = {
  153 |       appcommon: { setScreenSaver: (n) => (window.screensaver = n) },
  154 |       avplay: {
  155 |         open: () => (window.avState = "IDLE"),
  156 |         setDisplayRect: () => {},
  157 |         setDisplayMethod: () => {},
  158 |         setListener: () => {},
  159 |         prepareAsync: (cb) => {
  160 |           window.avState = "READY";
  161 |           setTimeout(cb, 0);
  162 |         },
  163 |         play: () => (window.avState = "PLAYING"),
  164 |         pause: () => (window.avState = "PAUSED"),
  165 |         stop: () => (window.avState = "IDLE"),
  166 |         close: () => (window.avState = "NONE"),
  167 |         getState: () => window.avState,
  168 |         getDuration: () => 60000,
  169 |         getCurrentTime: () => 1000,
  170 |         seekTo: () => {},
  171 |       },
  172 |     };
  173 |   });
  174 |   await page.goto("/");
  175 |   await page.getByRole("button", { name: "Explore demo" }).click();
  176 |   await page.getByRole("button", { name: "Movies", exact: true }).click();
  177 |   await page
  178 |     .getByRole("button", { name: "Open Big Buck Bunny", exact: true })
  179 |     .click();
  180 |   await page.getByRole("button", { name: "Play now", exact: true }).click();
  181 |   await expect.poll(() => page.evaluate(() => window.avState)).toBe("PLAYING");
  182 |   await page.evaluate(() =>
  183 |     document.dispatchEvent(
  184 |       new KeyboardEvent("keydown", { keyCode: 415, bubbles: true }),
  185 |     ),
  186 |   );
  187 |   expect(await page.evaluate(() => window.avState)).toBe("PLAYING");
  188 |   await page.evaluate(() =>
  189 |     document.dispatchEvent(
  190 |       new KeyboardEvent("keydown", { keyCode: 19, bubbles: true }),
  191 |     ),
  192 |   );
  193 |   expect(
  194 |     await page.evaluate(() => [window.avState, window.screensaver]),
  195 |   ).toEqual(["PAUSED", 1]);
  196 |   await page.evaluate(() =>
  197 |     document.dispatchEvent(
  198 |       new KeyboardEvent("keydown", { keyCode: 19, bubbles: true }),
  199 |     ),
  200 |   );
  201 |   expect(await page.evaluate(() => window.avState)).toBe("PAUSED");
  202 |   await page.evaluate(() =>
  203 |     document.dispatchEvent(
  204 |       new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
  205 |     ),
  206 |   );
  207 |   await expect(page.getByRole("dialog", { name: /Playing/ })).toHaveCount(0);
  208 |   expect(
  209 |     await page.evaluate(() => [window.avState, window.screensaver]),
  210 |   ).toEqual(["NONE", 1]);
  211 | });
  212 | 
  213 | test("Samsung AVPlay selects an available Arabic provider subtitle", async ({
  214 |   page,
  215 | }) => {
  216 |   await page.addInitScript(() => {
```