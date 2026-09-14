import { AppError } from "./errors.js";

const art = (name) => `/artwork/${name}.jpg`;
const sample = (name) =>
  ({
    BigBuckBunny: "https://media.w3.org/2010/05/bunny/movie.mp4",
    Sintel: "https://media.w3.org/2010/05/sintel/trailer.mp4",
    TearsOfSteel:
      "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
    BunnyTrailer: "https://media.w3.org/2010/05/bunny/trailer.mp4",
  })[name];
const movies = [
  {
    id: "1",
    name: "Big Buck Bunny",
    categoryId: "animation",
    image: art("forest"),
    year: "2008",
    rating: "7.0",
    plot: "A gentle giant finds that even a peaceful day in the forest can become an adventure. A Blender Foundation open movie.",
    source: sample("BigBuckBunny"),
  },
  {
    id: "2",
    name: "Sintel · Trailer",
    categoryId: "animation",
    image: art("mountains"),
    year: "2010",
    rating: "7.4",
    plot: "A young traveler crosses a breathtaking world in search of a lost friend. Trailer for the Blender Foundation open movie.",
    source: sample("Sintel"),
  },
  {
    id: "3",
    name: "Tears of Steel",
    categoryId: "scifi",
    image: art("city"),
    year: "2012",
    rating: "7.1",
    plot: "In a future Amsterdam, a team must revisit the past to save the world. A Blender Foundation open movie.",
    source: sample("TearsOfSteel"),
  },
  {
    id: "4",
    name: "Big Buck Bunny · Trailer",
    categoryId: "animation",
    image: art("ocean"),
    year: "2008",
    rating: "7.0",
    plot: "A preview of the Blender Foundation open movie. Demo sample hosted by W3C.",
    source: sample("BunnyTrailer"),
  },
].map((item) => ({
  ...item,
  kind: "movie",
  extension: item.source.endsWith(".m3u8") ? "m3u8" : "mp4",
}));
const channels = [
  {
    id: "101",
    name: "Open Cinema",
    categoryId: "cinema",
    image: art("forest"),
    source: movies[0].source,
    plot: "Demo channel playing the Big Buck Bunny short film.",
  },
  {
    id: "102",
    name: "Adventure Showcase",
    categoryId: "cinema",
    image: art("mountains"),
    source: movies[1].source,
    plot: "Demo channel playing the Sintel short film.",
  },
  {
    id: "103",
    name: "Sci-fi Screen",
    categoryId: "cinema",
    image: art("city"),
    source: movies[2].source,
    plot: "Demo channel playing the Tears of Steel short film.",
  },
  {
    id: "104",
    name: "Animation Studio",
    categoryId: "animation",
    image: art("ocean"),
    source: movies[3].source,
    plot: "Demo channel playing the Big Buck Bunny trailer.",
  },
].map((item) => ({
  ...item,
  kind: "live",
  year: "",
  rating: "",
  extension: item.source.endsWith(".m3u8") ? "m3u8" : "mp4",
}));
const series = [
  {
    id: "201",
    kind: "series",
    name: "The Open Movie Collection",
    categoryId: "collections",
    image: art("mountains"),
    year: "2026",
    rating: "",
    plot: "A demo collection of independent Blender short films, grouped into two sample seasons. Connect your subscription to see your real series.",
  },
  {
    id: "202",
    kind: "series",
    name: "Worlds of Imagination",
    categoryId: "collections",
    image: art("city"),
    year: "2026",
    rating: "",
    plot: "A second sample collection for exploring the episode browser. Episodes play Blender open movies.",
  },
];
const data = { live: channels, movie: movies, series };
const categories = {
  live: [
    { id: "cinema", name: "Cinema" },
    { id: "animation", name: "Animation" },
  ],
  movie: [
    { id: "animation", name: "Animation" },
    { id: "scifi", name: "Science fiction" },
  ],
  series: [{ id: "collections", name: "Open movie collections" }],
};
const publicItem = ({ source, ...item }) => item;

export const demoProfile = {
  name: "Demo experience",
  demo: true,
  server: "",
  status: "Demo",
  expiresAt: null,
  maxConnections: 0,
  activeConnections: 0,
};
export function demoCatalog(
  kind,
  { category = "", q = "", page = 1, limit = 36 } = {},
) {
  const rows = data[kind].filter(
    (item) =>
      (!category || item.categoryId === category) &&
      (!q || item.name.toLowerCase().includes(q.toLowerCase())),
  );
  return {
    items: rows.slice((page - 1) * limit, page * limit).map(publicItem),
    categories: categories[kind],
    total: rows.length,
    page,
    pages: Math.max(1, Math.ceil(rows.length / limit)),
  };
}
export function demoDetails(kind, id) {
  const row = data[kind].find((item) => item.id === id);
  if (!row) throw new AppError(404, "This demo title is unavailable.");
  const details = {
    item: publicItem(row),
    plot: row.plot,
    genre: kind === "live" ? "Demo channel" : "Open movies",
    director: "Blender Foundation",
    cast: "",
    duration: "",
    epg: [],
  };
  if (kind === "series") {
    details.seasons = [1, 2];
    details.episodes = movies.map((item, i) => ({
      ...publicItem(item),
      id: String(301 + i),
      kind: "episode",
      season: i < 2 ? 1 : 2,
      episode: (i % 2) + 1,
      seriesId: id,
      seriesName: row.name,
    }));
  }
  return details;
}
export function demoPlay(media, session, { kind, id }) {
  const row =
    kind === "episode"
      ? movies[Number(id) - 301]
      : data[kind]?.find((item) => item.id === id);
  if (!row?.source) throw new AppError(404, "This demo video is unavailable.");
  return {
    url: media.issue(row.source, session.id),
    mime: row.source.endsWith(".m3u8")
      ? "application/vnd.apple.mpegurl"
      : "video/mp4",
    live: kind === "live",
  };
}
