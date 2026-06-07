/**
 * Oploverz API - Vercel Serverless
 * Scraper: ShanMolvyr
 * API Wrapper: DonghuaVerse
 */

const axios   = require("axios");
const cheerio = require("cheerio");

const BASE    = "https://vip.oploverz.ltd";
const BACKAPI = "https://backapi.oploverz.ac/uploads/";

const HEADERS_HTML = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
};

const HEADERS_DATA = {
  "accept": "*/*",
  "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
};

const http = axios.create({ baseURL: BASE, timeout: 25000 });

// Filter iklan dinonaktifkan — semua link ditampilkan
function isClean(url = "") {
  return !!url;
}

function decodeSvelteFlat(raw) {
  if (!raw || !Array.isArray(raw.nodes)) return null;
  const dataNode = raw.nodes.find(n => n?.type === "data" && Array.isArray(n.data));
  if (!dataNode) return null;
  const arr = dataNode.data;
  function resolve(idx) {
    if (idx === null || idx === undefined) return null;
    const val = arr[idx];
    if (val === null || val === undefined) return val;
    if (typeof val !== "object") return val;
    if (Array.isArray(val)) return val.map(i => resolve(i));
    const result = {};
    for (const [k, v] of Object.entries(val)) result[k] = resolve(v);
    return result;
  }
  return resolve(0);
}

async function fetchDataJson(path, referer) {
  const endpoint = (path === "/" ? "" : path) + "/__data.json?x-sveltekit-invalidated=001";
  const res = await http.get(endpoint, {
    headers: { ...HEADERS_DATA, Referer: referer || BASE + "/" }
  });
  return decodeSvelteFlat(res.data);
}

async function fetchHTML(path) {
  const res = await http.get(path, { headers: HEADERS_HTML });
  return res.data;
}

function fullUrl(path) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return BACKAPI + path;
}

function fmtStreamUrls(streamUrl = []) {
  return (streamUrl || [])
    .filter(s => s?.url && isClean(s.url))
    .map(s => ({ label: s.source, url: s.url }));
}

function fmtDownloads(downloadUrl = []) {
  return (downloadUrl || []).flatMap(fmt =>
    (fmt?.resolutions || []).flatMap(res =>
      (res?.download_links || [])
        .filter(l => l?.url && isClean(l.url))
        .map(l => ({
          format:  fmt.format  || null,
          quality: res.quality || null,
          host:    l.host      || null,
          url:     l.url,
        }))
    )
  );
}

function fmtSeries(s) {
  if (!s?.slug) return null;
  return {
    id:            s.id            || null,
    title:         s.title         || null,
    slug:          s.slug,
    status:        s.status        || null,
    poster:        fullUrl(s.poster),
    score:         s.score         || null,
    genres:        (s.genres || []).map(g => g?.name || g).filter(Boolean),
    studio:        s.studio?.name  || null,
    totalEpisodes: s.totalEpisodes || null,
    releaseDate:   s.releaseDate   || null,
  };
}

function fmtEpisodeCard(ep) {
  if (!ep) return null;
  return {
    id:            ep.id                      || null,
    seriesTitle:   ep.series?.title           || null,
    seriesSlug:    ep.series?.slug            || null,
    episodeNumber: ep.episodeNumber           || null,
    poster:        fullUrl(ep.series?.poster) || null,
    releasedAt:    ep.releasedAt              || null,
    streamUrls:    fmtStreamUrls(ep.streamUrl),
    downloadUrls:  fmtDownloads(ep.downloadUrl),
  };
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

async function getHome() {
  const decoded = await fetchDataJson("/", BASE + "/");
  if (!decoded) throw new Error("Gagal decode home");
  return {
    trending:       (decoded.trending?.data       || []).map(fmtSeries).filter(Boolean),
    recently:       (decoded.recently?.data       || []).map(fmtSeries).filter(Boolean),
    latestEpisodes: (decoded.latestEpisodes?.data || []).map(fmtEpisodeCard).filter(Boolean),
  };
}

async function getSeriesList(page = 1, sort_by = "recently", genre = "") {
  const query = new URLSearchParams({ page, sort_by, ...(genre && { genre }) });
  const res = await http.get(
    `/series/__data.json?x-sveltekit-invalidated=001&${query}`,
    { headers: { ...HEADERS_DATA, Referer: BASE + "/" } }
  ).catch(() => null);
  const decoded = res ? decodeSvelteFlat(res.data) : null;
  const items = (decoded?.allSeries?.data || []).map(fmtSeries).filter(Boolean);
  const meta  = decoded?.allSeries?.meta || {};
  return { items, total: meta.total || items.length, currentPage: meta.currentPage || +page, lastPage: meta.lastPage || 1 };
}

async function getDetail(slug) {
  const decoded = await fetchDataJson(`/series/${slug}`, BASE + "/");
  if (!decoded) throw new Error("Gagal decode detail");
  const s   = decoded.series   || {};
  const eps = decoded.episodes || {};
  const epList = eps.data || eps || [];
  return {
    id:            s.id              || null,
    title:         s.title           || null,
    slug,
    description:   s.description    || null,
    status:        s.status          || null,
    poster:        fullUrl(s.poster),
    score:         s.score           || null,
    genres:        (s.genres || []).map(g => g?.name || g).filter(Boolean),
    studio:        s.studio?.name    || null,
    season:        s.season?.name    || null,
    totalEpisodes: s.totalEpisodes   || epList.length,
    releaseDate:   s.releaseDate     || null,
    episodes: Array.isArray(epList)
      ? epList.map(ep => ({
          episodeNumber: ep.episodeNumber || null,
          title:         ep.title         || null,
          releasedAt:    ep.releasedAt    || null,
        })).filter(ep => ep.episodeNumber)
        .sort((a, b) => +a.episodeNumber - +b.episodeNumber)
      : [],
  };
}

async function getWatch(slug, epNumber) {
  const decoded = await fetchDataJson(
    `/series/${slug}/episode/${epNumber}`,
    `${BASE}/series/${slug}`
  );
  if (!decoded) throw new Error("Gagal decode watch");
  const ep  = decoded.episode     || {};
  const all = decoded.allEpisodes || decoded.episodes || {};
  const allList = all.data || all || [];
  return {
    seriesTitle:   ep.series?.title     || null,
    seriesSlug:    ep.series?.slug      || slug,
    episodeNumber: ep.episodeNumber     || epNumber,
    poster:        fullUrl(ep.series?.poster) || null,
    releasedAt:    ep.releasedAt        || null,
    streamUrls:    fmtStreamUrls(ep.streamUrl),
    downloadUrls:  fmtDownloads(ep.downloadUrl),
    allEpisodes: Array.isArray(allList)
      ? allList.map(e => ({ episodeNumber: e.episodeNumber || null }))
        .filter(e => e.episodeNumber)
        .sort((a, b) => +a.episodeNumber - +b.episodeNumber)
      : [],
  };
}

async function getSearch(query) {
  const res = await http.get(
    `/series/__data.json?x-sveltekit-invalidated=001&q=${encodeURIComponent(query)}`,
    { headers: { ...HEADERS_DATA, Referer: BASE + "/" } }
  ).catch(() => null);
  const decoded = res ? decodeSvelteFlat(res.data) : null;
  const items = (decoded?.allSeries?.data || []).map(fmtSeries).filter(Boolean);
  return { items, total: items.length };
}

// ── VERCEL HANDLER ────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url    = req.url || "/";
  const parts  = url.replace(/^\//, "").split("/");
  const route  = parts[0] || "home";

  try {
    let data;
    switch (route) {
      case "home":
        data = await getHome();
        break;
      case "series":
        data = await getSeriesList(parts[1] || 1, parts[2] || "recently", parts[3] || "");
        break;
      case "detail":
        if (!parts[1]) throw new Error("Slug diperlukan: /detail/:slug");
        data = await getDetail(parts[1]);
        break;
      case "watch":
        if (!parts[1] || !parts[2]) throw new Error("Diperlukan: /watch/:slug/:episode");
        data = await getWatch(parts[1], parts[2]);
        break;
      case "search":
        const q = parts.slice(1).join(" ") || req.query?.q || "";
        if (!q) throw new Error("Query diperlukan: /search/:keyword");
        data = await getSearch(q);
        break;
      default:
        return res.status(404).json({ status: false, error: "Route tidak ditemukan" });
    }
    res.status(200).json({ status: true, data });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
};
