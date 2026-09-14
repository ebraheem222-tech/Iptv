# Nova TV design

Build a personal IPTV client and backend for the user's existing paid subscription. User confirmed Samsung and LG TVs from 2020 through current models. Assume Xtream-compatible player_api.php credentials; no provider credentials are available during development.

## Product

Connection form: playlist name, provider server URL, username, password. Persist the session and reconnect automatically on launch. Provide a clearly labeled demo profile with sample media. Home, live channels (including provider sports categories), movies, series with seasons/episodes, global section search, category filters, favorites, resume progress, connection settings, and a full-screen player. All controls support mouse, keyboard and TV directional remote/OK/Back keys. Errors must be actionable; empty categories must not look like failed loads.

## Architecture and tradeoffs

A shared React 18 interface with a Node 22 Express API is preferred to two independently maintained TV apps. A browser-only app would be easier to deploy but lose Samsung AVPlay and local TV packaging. Separate native implementations would duplicate most work. The selected shared codebase has Samsung AVPlay and HTML video/native HLS/hls.js adapters, bundled as a classic IIFE targeting Chrome 68 for 2020 TV engines. CSS must avoid relying on flex gap, aspect-ratio, :has or :focus-visible.

Backend authenticates with Xtream player_api.php, normalizes catalogs, caches responses, paginates large lists, serves guide/details, and resolves playback URLs. An authenticated stream request issues an opaque ticket. Proxy rewrites HLS playlist URLs including keys and variants, follows validated redirects, forwards byte ranges, and streams without buffering entire media files. No transcoding or DRM removal. HTTP providers are supported through the backend; HTTPS recommended for deployment.

Credentials and preferences are encrypted at rest in an atomic JSON vault with a locally generated persistent key. Bearer tokens are hashed server-side. Sessions expire after 30 days and logout revokes associated media access. Outbound network addresses are DNS validated and pinned; nonpublic destinations blocked unless explicitly allowed in development. Limit login attempts, metadata sizes, tickets and cache size. Never return provider passwords or log full provider URLs. This initial backend is one process with local storage, designed for a home server rather than a public multi-tenant service.

## API contract

POST /api/connect {name,url,username,password} -> {token,profile}; POST /api/demo -> same. Authorization: Bearer token on all API routes below.
Profile: {name,demo,server,status,expiresAt,maxConnections,activeConnections}. GET /api/session -> {profile,preferences}; DELETE /api/session -> 204.
GET /api/catalog/:kind?category=&q=&page=&limit= -> {items,categories,total,page,pages}. kind = live|movie|series. Category {id,name}. Item {id,kind,name,categoryId,image,year,rating,extension?,plot?}. IDs strings. Image is a same-backend path or a relative public asset; it may be empty.
GET /api/details/:kind/:id -> {item,plot,genre,director,cast,duration,seasons?,episodes?,epg?}. Episode {id,kind:'episode',name,season,episode,extension,image,plot,duration}. epg entries {title,description,start,end} ISO dates. Seasons numeric array, episodes flat array.
POST /api/play {kind,id,extension?} -> {url,mime,live}; URL a relative media proxy path. episode stream uses movie-compatible /series provider route; resolve its extension from validated details or allow a short safe extension. Frontend passes the extension received with the item. GET /media/:ticket/:filename -> proxied media bytes/HLS.
GET /api/preferences -> {favorites:Item[],progress:{[kind+':'+id]:{item,position,duration,updatedAt}}}. PUT /api/preferences/favorite {item} -> preferences (toggle). PUT /api/preferences/progress {item,position,duration} -> preferences. Item metadata is sanitized server-side, no credentials. Limit favorites 500 and progress 200 entries.

## Delivery and validation

Complete local runnable source, dependency lockfile, production static build, LG/Samsung package source folders, Docker configuration, environment example, setup and TV install instructions. Signing/physical installation require the user's TV and developer certificate. Do not claim device compatibility has been physically tested.

Automate provider authentication, catalog pagination, series details, credential encryption, private-address rejection, HLS rewriting, ranges, session isolation/logout and progress persistence using a local provider fixture. Browser checks exercise demo connection, remote navigation, filters, favorites, episode selection and media playback where available. Build both TV folders and parse/check manifests and assets. Record hardware and real-subscription validation limits.
