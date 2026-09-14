import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Home,
  Radio,
  Film,
  Clapperboard,
  Heart,
  Settings,
  Search,
  ArrowRight,
  Play,
  Plus,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Globe,
  Monitor,
  Signal,
  RefreshCw,
} from "lucide-react";
import { api, asset, saved, save, base } from "./lib/api";
import { useRemote, useModalFocus } from "./lib/remote";
import Player from "./components/Player";
import "./styles.css";
const sections = [
  ["home", "Discover", Home],
  ["live", "Live TV", Radio],
  ["movie", "Movies", Film],
  ["series", "Series", Clapperboard],
  ["favorites", "Favorites", Heart],
  ["settings", "Settings", Settings],
];
const emptyPrefs = { favorites: [], progress: {} };
function Logo() {
  return (
    <div className="logo">
      <span className="logo-symbol">N</span>
      <span>
        NOVA<span className="tv-word">TV</span>
      </span>
    </div>
  );
}
function ErrorBox({ message, retry }) {
  return message ? (
    <div className="error" role="alert">
      {String(message)}
      {retry && (
        <button onClick={retry}>
          <RefreshCw size={16} />
          Try again
        </button>
      )}
    </div>
  ) : null;
}
function BackendField() {
  const [value, setValue] = useState(base()),
    [message, setMessage] = useState("");
  return (
    <div className="backend-field">
      <label>
        Backend URL
        <input
          aria-label="Backend URL"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="http://192.168.1.10:3000"
        />
      </label>
      <p>
        On a TV, use the address of the computer running your NOVA server. Leave
        blank for this website’s server.
      </p>
      <button
        className="secondary"
        onClick={() => {
          try {
            if (value && !/^https?:$/.test(new URL(value).protocol)) throw 0;
            const changed = value.replace(/\/$/, "") !== base();
            save("nova.backend", value.replace(/\/$/, ""));
            if (changed) {
              save("nova.token", "");
              window.location.reload();
            } else setMessage("Backend address saved.");
          } catch {
            setMessage("Enter a complete http:// or https:// address.");
          }
        }}
      >
        Save address
      </button>
      <span role="status">{message}</span>
    </div>
  );
}
function Connect({ connected }) {
  const [form, setForm] = useState({
      name: "My playlist",
      url: "",
      username: "",
      password: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function connect(demo) {
    setBusy(true);
    setError("");
    try {
      const data = await api(
        demo ? "/api/demo" : "/api/connect",
        "POST",
        demo ? {} : form,
      );
      save("nova.token", data.token);
      connected(data.profile);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="connect">
      <div
        className="connect-art"
        style={{
          backgroundImage: `linear-gradient(0deg,#090d13 0%,transparent 90%),url('${asset("/artwork/mountains.jpg")}')`,
        }}
      >
        <Logo />
        <div className="connect-copy">
          <span className="eyebrow">A BETTER WAY TO WATCH</span>
          <h1>
            Your world.
            <br />
            On play.
          </h1>
          <p>
            Live moments. Great stories.
            <br />
            One place for everything you love.
          </p>
          <div className="connect-tags">
            <span>
              <Monitor size={16} />
              Built for the big screen
            </span>
            <span>
              <Signal size={16} />
              Your own subscription
            </span>
          </div>
        </div>
        <span className="photo-caption">MORE TO DISCOVER. EVERY DAY.</span>
      </div>
      <main className="connect-panel">
        <span className="eyebrow accent">WELCOME TO NOVA</span>
        <h2>Make yourself at home.</h2>
        <p>Connect your IPTV playlist to start watching.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            connect(false);
          }}
        >
          {[
            ["name", "Playlist name", "text"],
            ["url", "Provider URL", "url"],
            ["username", "Username", "text"],
            ["password", "Password", "password"],
          ].map(([key, label, type]) => (
            <label key={key}>
              {label}
              <input
                required
                type={type}
                autoComplete={
                  key === "password"
                    ? "current-password"
                    : key === "username"
                      ? "username"
                      : "off"
                }
                placeholder={
                  key === "url" ? "https://your-provider.com" : label
                }
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <ErrorBox message={error} />
          <button className="primary wide" disabled={busy}>
            {busy ? "Connecting…" : "Connect playlist"}
            <ArrowRight size={19} />
          </button>
        </form>
        <div className="divider">
          <span>JUST LOOKING AROUND?</span>
        </div>
        <button
          className="secondary wide"
          disabled={busy}
          onClick={() => connect(true)}
        >
          Explore demo
          <Play size={17} />
        </button>
        <p className="fine">
          Demo includes sample content. NOVA does not supply a TV subscription.
        </p>
        <details>
          <summary>Backend connection settings</summary>
          <BackendField />
        </details>
      </main>
    </div>
  );
}
function Poster({ item, onOpen, wide = false, progress }) {
  return (
    <button
      className={"poster " + (wide ? "landscape" : "")}
      aria-label={"Open " + item.name}
      onClick={() => onOpen(item)}
    >
      <div className="poster-art">
        <img
          src={asset(item.image)}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.opacity = 0;
          }}
        />
        <span className="poster-shade" />
        {item.kind === "live" ? (
          <span className="live-badge">
            <i />
            LIVE
          </span>
        ) : (
          <span className="quality">{item.year || "HD"}</span>
        )}
        <span className="poster-play">
          <Play fill="currentColor" size={23} />
        </span>
        <div className="art-title">{item.name}</div>
        {progress && (
          <div className="progress-bar">
            <i
              style={{
                width:
                  Math.min(100, (progress.position / progress.duration) * 100) +
                  "%",
              }}
            />
          </div>
        )}
      </div>
      <div className="poster-caption">
        <strong>{item.name}</strong>
        <span>
          {item.kind === "live"
            ? "Live channel"
            : item.kind === "series"
              ? "Series"
              : item.year || "Movie"}
          {item.rating ? " · ★ " + item.rating : ""}
        </span>
      </div>
    </button>
  );
}
function App() {
  const [profile, setProfile] = useState(null),
    [boot, setBoot] = useState(!!saved("nova.token")),
    [bootError, setBootError] = useState(""),
    [section, setSection] = useState("home"),
    [catalog, setCatalog] = useState({ items: [], categories: [] }),
    [home, setHome] = useState({ movie: [], live: [], series: [] }),
    [prefs, setPrefs] = useState(emptyPrefs),
    [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [playing, setPlaying] = useState(null),
    [reload, setReload] = useState(0);
  async function initialize() {
    setBootError("");
    try {
      const data = await api("/api/session");
      setProfile(data.profile);
      setPrefs(data.preferences || emptyPrefs);
    } catch (e) {
      setBootError(e.message);
    } finally {
      setBoot(false);
    }
  }
  useEffect(() => {
    if (saved("nova.token")) initialize();
  }, []);
  useEffect(() => {
    if (!profile) return;
    api("/api/preferences")
      .then(setPrefs)
      .catch((e) => setError(e.message));
  }, [profile]);
  useEffect(() => {
    if (!profile) return;
    let active = true;
    const controller = new AbortController();
    setError("");
    if (["settings", "favorites"].indexOf(section) >= 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setCatalog((previous) => ({ ...previous, items: [], total: 0, pages: 1 }));
    const run =
      section === "home"
        ? Promise.all(
            ["movie", "live", "series"].map((k) =>
              api(
                "/api/catalog/" + k + "?limit=6",
                "GET",
                undefined,
                controller.signal,
              ).then((d) => [k, d.items]),
            ),
          )
        : api(
            "/api/catalog/" +
              section +
              "?limit=24&page=" +
              page +
              "&q=" +
              encodeURIComponent(q) +
              "&category=" +
              encodeURIComponent(category),
            "GET",
            undefined,
            controller.signal,
          );
    run
      .then((data) => {
        if (!active) return;
        if (section === "home") {
          const next = {};
          data.forEach(([k, v]) => (next[k] = v));
          setHome(next);
        } else setCatalog(data);
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      controller.abort();
    };
  }, [profile, section, q, category, page, reload]);
  const navigate = (s) => {
    setCatalog({ items: [], categories: [], total: 0, pages: 1 });
    setSection(s);
    setQ("");
    setCategory("");
    setPage(1);
    window.scrollTo(0, 0);
  };
  const back = useCallback(() => {
    if (playing) setPlaying(null);
    else if (selected) setSelected(null);
    else if (section !== "home") navigate("home");
  }, [playing, selected, section]);
  useRemote(back);
  async function favorite(item) {
    try {
      setPrefs(await api("/api/preferences/favorite", "PUT", { item }));
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }
  if (boot)
    return (
      <div className="splash">
        <Logo />
        <p>Connecting to your world…</p>
      </div>
    );
  if (!profile && bootError)
    return (
      <div className="splash">
        <Logo />
        <ErrorBox message={bootError} retry={initialize} />
        <button
          className="secondary"
          onClick={() => {
            save("nova.token", "");
            setBootError("");
          }}
        >
          Return to connection
        </button>
      </div>
    );
  if (!profile) return <Connect connected={setProfile} />;
  const featured = home.movie[0];
  const progress = Object.keys(prefs.progress || {})
    .map((k) => prefs.progress[k])
    .filter(
      (p) => p.position > 15 && p.duration && p.position / p.duration < 0.95,
    )
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 6);
  return (
    <div className="app">
      <aside className="sidebar">
        <Logo />
        <nav aria-label="Main navigation">
          {sections.map(([id, label, Icon]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              onClick={() => navigate(id)}
              aria-label={label}
              title={label}
            >
              <Icon size={23} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">{profile.name?.slice(0, 1) || "N"}</span>
          <span>YOUR SPACE</span>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div className="breadcrumb">YOUR ENTERTAINMENT, ELEVATED</div>
          <div className="profile-pill">
            <i />
            {profile.demo ? "DEMO PLAYLIST" : profile.name}
            <span className="avatar small">
              {profile.name?.slice(0, 1) || "N"}
            </span>
          </div>
        </header>
        <ErrorBox message={error} retry={() => setReload(reload + 1)} />
        {section === "home" ? (
          <>
            <section
              className="hero"
              style={{
                backgroundImage: `linear-gradient(90deg,#0c1119 0%,rgba(12,17,25,.75) 35%,rgba(12,17,25,.08) 100%),linear-gradient(0deg,#0c1119,transparent 40%),url('${asset("/artwork/mountains.jpg")}')`,
              }}
            >
              <div className="hero-copy">
                <span className="eyebrow accent">
                  <span className="tiny-line" />
                  THE NEXT GREAT ESCAPE
                </span>
                <h1>
                  A whole world.
                  <br />
                  Just press play.
                </h1>
                <p>
                  Find your next favorite. From live TV to unforgettable
                  <br className="desktop-break" /> stories, it’s all right here.
                </p>
                <div className="hero-actions">
                  <button
                    className="primary"
                    onClick={() =>
                      featured ? setSelected(featured) : navigate("movie")
                    }
                  >
                    <Play size={19} fill="currentColor" />
                    {profile.demo ? "Explore demo film" : "Explore movies"}
                  </button>
                  <button className="glass" onClick={() => navigate("live")}>
                    <Radio size={19} />
                    Watch live
                  </button>
                </div>
                <div className="hero-meta">
                  <span className="pill">
                    {profile.demo ? "DEMO COLLECTION" : "YOUR COLLECTION"}
                  </span>
                  <span>Made for your moments</span>
                </div>
              </div>
              <div className="hero-marker">
                <span>01</span>
                <i />
                <span>DISCOVER SOMETHING GREAT</span>
              </div>
            </section>
            <div className="home-rows">
              {progress.length > 0 && (
                <section>
                  <div className="row-heading">
                    <h2>Pick up where you left off</h2>
                    <span>CONTINUE WATCHING</span>
                  </div>
                  <div className="poster-grid">
                    {progress.map((p) => (
                      <Poster
                        key={p.item.kind + p.item.id}
                        item={p.item}
                        onOpen={setPlaying}
                        progress={p}
                      />
                    ))}
                  </div>
                </section>
              )}
              {[
                ["live", "On air. Right now.", "Live TV"],
                ["movie", "A good night starts here.", "Movies"],
                ["series", "Your next obsession.", "Series"],
              ].map(([kind, title, label]) => (
                <section key={kind}>
                  <div className="row-heading">
                    <h2>{title}</h2>
                    <button onClick={() => navigate(kind)}>
                      All {label.toLowerCase()}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  {loading ? (
                    <p className="muted">Finding your favorites…</p>
                  ) : (
                    <div
                      className={
                        "poster-grid " + (kind === "live" ? "live-grid" : "")
                      }
                    >
                      {home[kind]?.map((item) => (
                        <Poster
                          key={item.id}
                          item={item}
                          wide={kind === "live"}
                          onOpen={setSelected}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </>
        ) : section === "settings" ? (
          <section className="page settings">
            <span className="eyebrow accent">MAKE IT YOURS</span>
            <h1>Settings</h1>
            <div className="settings-card">
              <h2>Your connection</h2>
              <dl>
                {[
                  ["Playlist", profile.name],
                  [
                    "Profile",
                    profile.demo
                      ? "Demo — sample content"
                      : "IPTV subscription",
                  ],
                  ["Server", profile.server || "NOVA demo"],
                  ["Status", profile.status || "Connected"],
                  [
                    "Expires",
                    profile.expiresAt
                      ? new Date(profile.expiresAt).toLocaleDateString()
                      : "Not provided",
                  ],
                  [
                    "Connections",
                    String(profile.activeConnections || 0) +
                      " / " +
                      String(profile.maxConnections || "—"),
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await api("/api/session", "DELETE");
                    save("nova.token", "");
                    setProfile(null);
                    setPrefs(emptyPrefs);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                <LogOut size={18} />
                Disconnect playlist
              </button>
            </div>
            <div className="settings-card">
              <h2>Backend connection</h2>
              <BackendField />
            </div>
            <p className="muted">
              NOVA TV · Navigate with arrow keys, select with OK, return with
              Back.
            </p>
          </section>
        ) : (
          <section className="page">
            <span className="eyebrow accent">
              {section === "favorites"
                ? "SAVED FOR YOU"
                : "YOUR PERSONAL COLLECTION"}
            </span>
            <h1>{sections.find((s) => s[0] === section)?.[1]}</h1>
            <div className="filterbar">
              <label className="search">
                <Search size={20} />
                <input
                  aria-label="Search library"
                  placeholder="Find something great…"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              {section !== "favorites" && (
                <select
                  aria-label="Category"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All categories</option>
                  {catalog.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="count">
                {section === "favorites"
                  ? prefs.favorites.length
                  : catalog.total || 0}{" "}
                titles
              </span>
            </div>
            {loading ? (
              <div className="empty">Loading your collection…</div>
            ) : (
              <>
                <div
                  className={
                    "poster-grid collection " +
                    (section === "live" ? "live-grid" : "")
                  }
                >
                  {(section === "favorites"
                    ? prefs.favorites.filter((i) =>
                        i.name.toLowerCase().includes(q.toLowerCase()),
                      )
                    : catalog.items
                  ).map((item) => (
                    <Poster
                      key={item.kind + item.id}
                      item={item}
                      wide={section === "live"}
                      onOpen={setSelected}
                    />
                  ))}
                </div>
                {!(section === "favorites"
                  ? prefs.favorites.filter((i) =>
                      i.name.toLowerCase().includes(q.toLowerCase()),
                    ).length
                  : catalog.items.length) && (
                  <div className="empty">
                    <Film size={38} />
                    <h2>
                      {section === "favorites"
                        ? "Your favorites start here."
                        : "Nothing here yet."}
                    </h2>
                    <p>
                      {section === "favorites"
                        ? "Open a title and save it to your favorites."
                        : "Try another category or a different search."}
                    </p>
                  </div>
                )}
                {section !== "favorites" && catalog.pages > 1 && (
                  <div className="pagination">
                    <button
                      className="secondary"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft />
                      Previous
                    </button>
                    <span>
                      Page {page} of {catalog.pages}
                    </span>
                    <button
                      className="secondary"
                      disabled={page >= catalog.pages}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                      <ChevronRight />
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
        <footer>
          <Logo />
          <span>GOOD STORIES. GREAT MOMENTS.</span>
          <span>
            {profile.demo ? "DEMO EXPERIENCE" : "YOUR WORLD. ON PLAY."}
          </span>
        </footer>
      </main>
      {selected && !playing && (
        <Details
          item={selected}
          prefs={prefs}
          favorite={favorite}
          close={() => setSelected(null)}
          play={setPlaying}
        />
      )}{" "}
      {playing && (
        <Player
          item={playing}
          progress={prefs.progress?.[playing.kind + ":" + playing.id]}
          onProgress={(p) => setPrefs(p)}
          close={() => setPlaying(null)}
        />
      )}
    </div>
  );
}
function Details({ item, prefs, favorite, close, play }) {
  const ref = useRef(null);
  useModalFocus(ref);
  const [details, setDetails] = useState(null),
    [error, setError] = useState(""),
    [season, setSeason] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    api(
      "/api/details/" + item.kind + "/" + encodeURIComponent(item.id),
      "GET",
      undefined,
      controller.signal,
    )
      .then((d) => {
        if (active) {
          setDetails(d);
          setSeason(String(d.seasons?.[0] || d.episodes?.[0]?.season || 1));
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
      controller.abort();
    };
  }, [item]);
  const isFavorite = prefs.favorites.some(
    (i) => i.id === item.id && i.kind === item.kind,
  );
  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <section
        ref={ref}
        className="details-modal"
        data-modal
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
      >
        <div
          className="detail-art"
          style={{
            backgroundImage: `linear-gradient(0deg,#111822,transparent),url('${asset(item.image)}')`,
          }}
        />
        <button
          className="icon-button close"
          aria-label="Close details"
          onClick={close}
        >
          <X />
        </button>
        <div className="detail-body">
          <span className="eyebrow accent">
            {item.kind === "live" ? "LIVE TELEVISION" : item.kind.toUpperCase()}
          </span>
          <h1>{item.name}</h1>
          <div className="detail-meta">
            {[
              item.year,
              details?.genre,
              item.rating ? "★ " + item.rating : null,
              details?.duration,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <p>
            {details?.plot || item.plot || "Discover something worth watching."}
          </p>
          <ErrorBox message={error} />
          <div className="detail-actions">
            {item.kind !== "series" && (
              <button
                className="primary"
                onClick={() => play(details?.item || item)}
              >
                <Play size={19} fill="currentColor" />
                {item.kind === "live"
                  ? "Watch live"
                  : prefs.progress?.[item.kind + ":" + item.id]?.position > 15
                    ? "Resume"
                    : "Play now"}
              </button>
            )}
            <button
              className="secondary"
              disabled={busy}
              aria-label={
                isFavorite ? "Remove from favorites" : "Add to favorites"
              }
              onClick={async () => {
                setBusy(true);
                try {
                  await favorite(details?.item || item);
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {isFavorite ? <Check size={19} /> : <Plus size={19} />}{" "}
              {isFavorite ? "In your favorites" : "My favorites"}
            </button>
          </div>
          {details?.cast && <p className="muted">Cast: {details.cast}</p>}
          {!details && !error && <p>Loading details…</p>}
          {item.kind === "series" && details && (
            <div className="episodes">
              <label>
                Season
                <select
                  aria-label="Season"
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                >
                  {(details.seasons || []).map((s) => (
                    <option key={s} value={s}>
                      Season {s}
                    </option>
                  ))}
                </select>
              </label>
              {details.episodes
                ?.filter((e) => String(e.season) === season)
                .map((e) => (
                  <button
                    className="episode"
                    key={e.id}
                    onClick={() => play(e)}
                  >
                    <span className="episode-number">
                      {String(e.episode).padStart(2, "0")}
                    </span>
                    <span>
                      <strong>{e.name}</strong>
                      <small>{e.plot || e.duration || "Play episode"}</small>
                    </span>
                    <Play size={20} />
                  </button>
                ))}
              {!details.episodes?.length && (
                <p>No episodes were supplied by this provider.</p>
              )}
            </div>
          )}
          {item.kind === "live" && details && (
            <div className="guide">
              <h2>Channel guide</h2>
              {details.epg?.length ? (
                details.epg.map((e, i) => (
                  <div key={i}>
                    <time>
                      {new Date(e.start).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <span>
                      <strong>{e.title}</strong>
                      <p>{e.description}</p>
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted">
                  Your provider has no guide information for this channel.
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
