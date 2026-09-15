# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui.spec.js >> Samsung AVPlay selects an available Arabic provider subtitle
- Location: tests\ui.spec.js:213:1

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
  217 |     window.avState = "NONE";
  218 |     window.webapis = {
  219 |       appcommon: { setScreenSaver: () => {} },
  220 |       avplay: {
  221 |         open: () => (window.avState = "IDLE"),
  222 |         setDisplayRect: () => {},
  223 |         setDisplayMethod: () => {},
  224 |         setListener: () => {},
  225 |         prepareAsync: (callback) => {
  226 |           window.avState = "READY";
  227 |           setTimeout(callback, 0);
  228 |         },
  229 |         play: () => (window.avState = "PLAYING"),
  230 |         pause: () => (window.avState = "PAUSED"),
  231 |         stop: () => (window.avState = "IDLE"),
  232 |         close: () => (window.avState = "NONE"),
  233 |         getState: () => window.avState,
  234 |         getDuration: () => 60000,
  235 |         getCurrentTime: () => 1000,
  236 |         seekTo: () => {},
  237 |         getTotalTrackInfo: () => [
  238 |           {
  239 |             type: "TEXT",
  240 |             index: 3,
  241 |             extra_info: JSON.stringify({
  242 |               track_lang: "eng",
  243 |               title: "English",
  244 |             }),
  245 |           },
  246 |           {
  247 |             type: "TEXT",
  248 |             index: 4,
  249 |             extra_info: JSON.stringify({
  250 |               track_lang: "ara",
  251 |               title: "Arabic",
  252 |             }),
  253 |           },
  254 |         ],
  255 |         setSelectTrack: (type, index) =>
  256 |           (window.selectedSubtitle = [type, index]),
  257 |         setSilentSubtitle: (silent) =>
  258 |           (window.subtitleIsSilent = silent),
  259 |       },
  260 |     };
  261 |   });
  262 |   await page.route("**/api/captions/**", (route) =>
  263 |     route.fulfill({ json: { tracks: [] } }),
  264 |   );
  265 |   await page.goto("/");
  266 |   await page.getByRole("button", { name: "Explore demo" }).click();
> 267 |   await page.getByRole("button", { name: "Movies", exact: true }).click();
      |                                                                   ^ Error: locator.click: Test timeout of 30000ms exceeded.
  268 |   await page
  269 |     .getByRole("button", { name: "Open Big Buck Bunny", exact: true })
  270 |     .click();
  271 |   await page.getByRole("button", { name: "Play now", exact: true }).click();
  272 | 
  273 |   await expect
  274 |     .poll(() => page.evaluate(() => window.selectedSubtitle))
  275 |     .toEqual(["TEXT", 4]);
  276 |   expect(await page.evaluate(() => window.subtitleIsSilent)).toBe(false);
  277 |   await expect(
  278 |     page.getByRole("button", { name: "Captions: العربية" }),
  279 |   ).toBeVisible();
  280 | });
  281 | 
```