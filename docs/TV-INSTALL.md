# Install Nova TV on a television

Build the shared client first:

```sh
npm ci
npm run build:tv
```

Edit `build/samsung/config.js` or `build/lg/config.js` and set `apiBase` to the computer's reachable LAN address, for example `http://192.168.1.20:3000`. Start the backend with `npm start` or `docker compose up --build -d`, allow inbound TCP port 3000 in the computer firewall, and confirm the same URL opens from another device on the TV network.

## Samsung Tizen

Install Tizen Studio plus the Samsung TV Extension, Samsung Certificate Extension, and Web CLI. On the TV, open **Apps**, open **App Settings**, enter `12345`, turn Developer Mode on, enter the development computer's IP, and reboot. Connect the TV in Tizen Studio Device Manager and choose **Permit to install applications**.

Create a Samsung certificate profile in Tizen Studio Certificate Manager. A signing identity is device/user-specific and is intentionally not included here. Then run from the repository root, replacing `MySamsungProfile` and the target name:

```sh
tizen build-web -- build/samsung
tizen package -t wgt -s MySamsungProfile -- build/samsung/.buildResult
sdb devices
tizen install -t <target-name> --name NovaTV.wgt -- build/samsung/.buildResult
tizen run -t <target-name> -p N0vaTV0001.NovaTV
```

The exact generated `.wgt` filename may differ; use the filename produced by `tizen package`. Samsung only installs signed `.wgt` packages on a TV. Nova loads `$WEBAPIS/webapis/webapis.js` only in this Samsung build, before `app.js`, so AVPlay can be selected at runtime.

Official references: [Samsung TV device setup](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html), [Samsung TV CLI](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html), and [application configuration](https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html).

## LG webOS

Install the webOS CLI and the **Developer Mode** app from LG Apps. Sign in to the Developer Mode app with an LG Developer account, enable Dev Mode, reboot, and enable its Key Server. Register the TV (port `9922`, user `prisoner`) and fetch its key:

```sh
ares-setup-device
ares-novacom --device myTV --getkey
ares-device --system-info --device myTV
npm exec --yes --package=@webos-tools/cli@3.2.6 -c "ares-package build/lg -o build"
ares-install --device myTV build/tv.nova.app.iptv_1.0.0_all.ipk
ares-launch --device myTV tv.nova.app.iptv
```

Enter the six-character passphrase shown by the Developer Mode app when `ares-novacom` asks. This repository has produced `build/tv.nova.app.iptv_1.0.0_all.ipk`; rebuild it after changing `config.js` or application files. Developer Mode expires and apps installed through it are removed when the session expires, so use **EXTEND** while the session remains active. Samsung remains a project folder until you package it with your Samsung certificate profile; its signing requirement is separate from this LG developer IPK.

Official references: [LG Developer Mode setup](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app), [webOS CLI guide](https://webostv.developer.lge.com/develop/tools/webos-tv-cli-dev-guide), and [`appinfo.json` reference](https://webostv.developer.lge.com/develop/references/appinfo-json).

## Playback troubleshooting

- A blank catalog with connection errors usually means the TV cannot reach `apiBase`; test the URL from another LAN device and check the host firewall.
- Authentication errors require the exact provider base URL, username, and password. Do not append `player_api.php` unless your provider explicitly gave that as its server URL.
- Playback errors can be format or subscription-limit failures. Nova does not transcode or bypass DRM. Try a known HLS stream, stop other active streams, and check the provider's allowed connection count.
- HTTP content can be blocked when the app/backend is served under HTTPS. Use one consistent scheme; use a trusted HTTPS reverse proxy for access beyond the home LAN.
