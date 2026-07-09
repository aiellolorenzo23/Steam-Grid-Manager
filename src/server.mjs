import http from "node:http";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const defaultSteamPath = "C:\\Program Files (x86)\\Steam";
const port = Number(process.env.PORT || 5177);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};
const artworkExtensions = [".png", ".jpg", ".jpeg", ".webp", ".webm", ".mp4", ".ico"];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(url, req, res);
      return;
    }
    await serveStatic(url, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(port, () => {
  console.log(`Steam Grid Manager running at http://localhost:${port}`);
});

async function handleApi(url, req, res) {
  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, defaultSteamPath });
    return;
  }

  if (url.pathname === "/api/steam/scan") {
    const steamPath = url.searchParams.get("steamPath") || defaultSteamPath;
    const selectedUserId = url.searchParams.get("userId") || "";
    const steamApiKey = url.searchParams.get("steamApiKey") || "";
    const includeOwnedLibrary = url.searchParams.get("includeOwnedLibrary") === "1";
    sendJson(res, 200, await scanSteam(steamPath, selectedUserId, steamApiKey, includeOwnedLibrary));
    return;
  }

  if (url.pathname === "/api/sgdb/search") {
    const apiKey = url.searchParams.get("apiKey") || "";
    const query = url.searchParams.get("q") || "";
    const steamAppId = url.searchParams.get("steamAppId") || "";
    const assetType = url.searchParams.get("assetType") || "gridVertical";
    const tags = csvParam(url.searchParams.get("tags") || "");
    const types = csvParam(url.searchParams.get("types") || "");
    const mimes = csvParam(url.searchParams.get("mimes") || "");
    const dimensions = csvParam(url.searchParams.get("dimensions") || "");
    sendJson(res, 200, await searchSteamGridDb({ apiKey, query, steamAppId, assetType, tags, types, mimes, dimensions }));
    return;
  }

  if (url.pathname === "/api/artwork/apply" && req.method === "POST") {
    const body = await readJsonBody(req);
    sendJson(res, 200, await applyArtwork(body));
    return;
  }

  if (url.pathname === "/api/artwork/local") {
    await serveLocalArtwork(url, res);
    return;
  }

  sendJson(res, 404, { error: "Endpoint not found" });
}

async function serveLocalArtwork(url, res) {
  const file = url.searchParams.get("path") || "";
  if (!file) {
    sendText(res, 400, "Missing path");
    return;
  }
  const resolved = path.resolve(file);
  const lower = resolved.toLowerCase();
  const isGrid = lower.includes(`${path.sep}userdata${path.sep}`) && lower.includes(`${path.sep}config${path.sep}grid${path.sep}`);
  const isLibraryCache = lower.includes(`${path.sep}appcache${path.sep}librarycache${path.sep}`);
  if (!isGrid && !isLibraryCache) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const data = await fs.readFile(resolved);
  res.writeHead(200, { "Content-Type": mimeTypes[path.extname(resolved).toLowerCase()] || "application/octet-stream" });
  res.end(data);
}

async function serveStatic(url, res) {
  const safePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(publicDir, `.${safePath}`);
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const data = await fs.readFile(filePath);
  res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
  res.end(data);
}

async function scanSteam(steamPath, selectedUserId, steamApiKey = "", includeOwnedLibrary = false) {
  const normalizedSteamPath = path.resolve(steamPath);
  const libraryFile = path.join(normalizedSteamPath, "steamapps", "libraryfolders.vdf");
  const libraryVdf = await readTextOptional(libraryFile);
  const parsedLibraries = libraryVdf ? parseKeyValueVdf(libraryVdf).libraryfolders || {} : {};
  const libraries = collectLibraries(parsedLibraries, normalizedSteamPath);
  const games = [];

  for (const library of libraries) {
    const steamapps = path.join(library.path, "steamapps");
    const manifests = await listFilesOptional(steamapps, /^appmanifest_\d+\.acf$/i);
    for (const manifest of manifests) {
      const text = await readTextOptional(path.join(steamapps, manifest));
      if (!text) continue;
      const appState = parseKeyValueVdf(text).AppState;
      if (!appState?.appid) continue;
    games.push({
        id: String(appState.appid),
        appId: String(appState.appid),
        gridId: String(appState.appid),
        name: appState.name || `App ${appState.appid}`,
        installDir: appState.installdir || "",
        libraryPath: library.path,
        libraryLabel: library.label,
        type: "steam",
        artwork: emptyArtwork()
      });
    }
  }

  const accounts = await scanAccounts(normalizedSteamPath);
  const requestedUserId = selectedUserId && selectedUserId !== "0" ? selectedUserId : "";
  const userId = requestedUserId && accounts.some((account) => account.id === requestedUserId) ? requestedUserId : pickActiveAccount(accounts);
  const nonSteamGames = userId ? await scanShortcuts(normalizedSteamPath, userId) : [];
  const activeAccount = accounts.find((account) => account.id === userId);
  let ownedLibraryStatus = "disabled";
  let ownedGames = [];
  if (includeOwnedLibrary) {
    ownedGames = await scanLocalConfigGames(normalizedSteamPath, userId, games);
    ownedLibraryStatus = `local:${ownedGames.length}`;
    try {
      const apiGames = await fetchOwnedGames(steamApiKey, activeAccount?.steamId64, games);
      ownedGames = mergeGames(ownedGames, apiGames);
      ownedLibraryStatus = `ok:${ownedGames.length}`;
    } catch (error) {
      ownedLibraryStatus = ownedGames.length ? `local:${ownedGames.length};api-error:${error.message}` : `error:${error.message}`;
    }
  }
  hydrateArtwork(normalizedSteamPath, userId, games);
  hydrateArtwork(normalizedSteamPath, userId, ownedGames);
  hydrateArtwork(normalizedSteamPath, userId, nonSteamGames);

  return {
    steamPath: normalizedSteamPath,
    libraries,
    accounts,
    selectedUserId: userId,
    games: [...games.sort(byName), ...ownedGames.sort(byName), ...nonSteamGames.sort(byName)],
    counts: {
      steam: games.length,
      owned: ownedGames.length,
      nonSteam: nonSteamGames.length,
      libraries: libraries.length,
      accounts: accounts.length
    },
    ownedLibraryStatus
  };
}

function collectLibraries(parsedLibraries, steamPath) {
  const found = new Map();
  found.set(path.resolve(steamPath).toLowerCase(), {
    id: "0",
    path: path.resolve(steamPath),
    label: driveLabel(steamPath)
  });

  for (const [id, entry] of Object.entries(parsedLibraries)) {
    if (!entry || typeof entry !== "object" || !entry.path) continue;
    const libraryPath = path.resolve(entry.path.replaceAll("\\\\", "\\"));
    found.set(libraryPath.toLowerCase(), {
      id,
      path: libraryPath,
      label: driveLabel(libraryPath),
      totalSize: entry.totalsize || "",
      updateCleanBytesTally: entry.update_clean_bytes_tally || ""
    });
  }

  return [...found.values()];
}

async function scanAccounts(steamPath) {
  const userdata = path.join(steamPath, "userdata");
  const loginUsers = await scanLoginUsers(steamPath);
  const entries = await listDirsOptional(userdata);
  return entries
    .filter((name) => /^\d+$/.test(name))
    .map((id) => {
      const login = loginUsers[id] || {};
      return {
        id,
        steamId64: login.SteamID64 || "",
        path: path.join(userdata, id),
        accountName: login.AccountName || "",
        personaName: login.PersonaName || "",
        hasLogin: Boolean(login.SteamID64),
        autoLogin: login.AutoLogin === "1",
        mostRecent: login.MostRecent === "1",
        timestamp: Number(login.Timestamp || 0),
        hasGrid: fssync.existsSync(path.join(userdata, id, "config", "grid")),
        hasShortcuts: fssync.existsSync(path.join(userdata, id, "config", "shortcuts.vdf"))
      };
    })
    .sort((a, b) => {
      if (a.id === "0") return 1;
      if (b.id === "0") return -1;
      return Number(b.autoLogin) - Number(a.autoLogin)
        || Number(b.mostRecent) - Number(a.mostRecent)
        || Number(b.hasLogin) - Number(a.hasLogin)
        || Number(b.timestamp) - Number(a.timestamp)
        || Number(b.hasShortcuts) - Number(a.hasShortcuts)
        || Number(b.hasGrid) - Number(a.hasGrid)
        || a.id.localeCompare(b.id);
    });
}

async function scanLoginUsers(steamPath) {
  const text = await readTextOptional(path.join(steamPath, "config", "loginusers.vdf"));
  if (!text) return {};
  const users = parseKeyValueVdf(text).users || {};
  const result = {};
  for (const [steamId64, data] of Object.entries(users)) {
    const accountId = steamId64ToAccountId(steamId64);
    if (accountId) result[accountId] = { ...data, SteamID64: steamId64 };
  }
  return result;
}

async function fetchOwnedGames(apiKey, steamId64, installedGames) {
  if (!apiKey) throw new Error("Steam Web API key mancante");
  if (!steamId64) throw new Error("SteamID64 non disponibile");
  const installed = new Set(installedGames.map((game) => String(game.appId)));
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId64,
    include_appinfo: "true",
    include_played_free_games: "true",
    include_free_sub: "true",
    format: "json"
  });
  const response = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${params.toString()}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Steam Web API HTTP ${response.status}`);
  const games = data.response?.games || [];
  return games
    .map((item) => String(item.appid || ""))
    .filter((appId) => appId && !installed.has(appId))
    .map((appId) => {
      const item = games.find((candidate) => String(candidate.appid) === appId) || {};
      return {
        id: `owned:${appId}`,
        appId,
        gridId: appId,
        name: item.name || `Steam App ${appId}`,
        installDir: "",
        exe: "",
        startDir: "",
        launchOptions: "",
        libraryPath: "Owned",
        libraryLabel: "Non installato",
        type: "owned",
        artwork: emptyArtwork()
      };
    });
}

function steamId64ToAccountId(steamId64) {
  try {
    const value = BigInt(steamId64) - 76561197960265728n;
    return value >= 0n ? String(value) : "";
  } catch {
    return "";
  }
}

function pickActiveAccount(accounts) {
  return accounts.find((account) => account.id !== "0" && account.autoLogin)?.id
    || accounts.find((account) => account.id !== "0" && account.mostRecent)?.id
    || accounts.filter((account) => account.id !== "0" && account.hasLogin).sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0]?.id
    || accounts.find((account) => account.id !== "0" && account.hasShortcuts)?.id
    || accounts.find((account) => account.id !== "0" && account.hasGrid)?.id
    || accounts.find((account) => account.id !== "0")?.id
    || accounts[0]?.id
    || "";
}

async function scanLocalConfigGames(steamPath, userId, installedGames) {
  if (!userId) return [];
  const text = await readTextOptional(path.join(steamPath, "userdata", String(userId), "config", "localconfig.vdf"));
  if (!text) return [];
  const parsed = parseKeyValueVdf(text);
  const localApps = parsed.UserLocalConfigStore?.Software?.valve?.Steam?.apps || parsed.UserLocalConfigStore?.Software?.Valve?.Steam?.apps || {};
  const installed = new Set(installedGames.map((game) => String(game.appId)));
  const appIds = Object.keys(localApps).filter((appId) => /^\d+$/.test(appId) && appId !== "0" && !installed.has(appId));
  if (!appIds.length) return [];

  const appNames = await readAppInfoNames(steamPath, appIds);
  return appIds.map((appId) => ({
    id: `owned:${appId}`,
    appId,
    gridId: appId,
    name: appNames.get(appId) || `Steam App ${appId}`,
    installDir: "",
    exe: "",
    startDir: "",
    launchOptions: "",
    libraryPath: "Owned",
    libraryLabel: "Non installato",
    type: "owned",
    artwork: emptyArtwork()
  }));
}

async function readAppInfoNames(steamPath, appIds) {
  const names = new Map();
  const buffer = await readBufferOptional(path.join(steamPath, "appcache", "appinfo.vdf"));
  if (!buffer) return names;
  for (const appId of appIds) {
    const marker = Buffer.alloc(4);
    marker.writeUInt32LE(Number(appId) >>> 0);
    let offset = buffer.indexOf(marker);
    while (offset >= 0) {
      const name = readAppInfoNameNear(buffer, offset);
      if (name) {
        names.set(appId, name);
        break;
      }
      offset = buffer.indexOf(marker, offset + 4);
    }
  }
  return names;
}

function readAppInfoNameNear(buffer, offset) {
  const key = Buffer.from([0x01, 0x04, 0x00, 0x00, 0x00]);
  const start = buffer.indexOf(key, offset);
  if (start < 0 || start > offset + 2048) return "";
  const valueStart = start + key.length;
  const valueEnd = buffer.indexOf(0, valueStart);
  if (valueEnd < 0 || valueEnd > valueStart + 240) return "";
  const value = buffer.toString("utf8", valueStart, valueEnd).trim();
  return value && !/[\u0000-\u001f]/.test(value) ? value : "";
}

function mergeGames(primary, secondary) {
  const byAppId = new Map();
  for (const game of primary) byAppId.set(String(game.appId), game);
  for (const game of secondary) {
    const appId = String(game.appId);
    const existing = byAppId.get(appId);
    byAppId.set(appId, existing ? { ...existing, ...game, artwork: existing.artwork } : game);
  }
  return [...byAppId.values()];
}

async function scanShortcuts(steamPath, userId) {
  const shortcutsPath = path.join(steamPath, "userdata", userId, "config", "shortcuts.vdf");
  const buffer = await readBufferOptional(shortcutsPath);
  if (!buffer) return [];
  return parseShortcutsVdf(buffer).map((shortcut) => {
    const appName = shortcut.AppName || shortcut.appname || "Non-Steam game";
    const exe = shortcut.Exe || shortcut.exe || "";
    const appId = shortcut.appid ? String(shortcut.appid >>> 0) : String(computeShortcutAppId(exe, appName));
    return {
      id: `nonsteam:${appId}`,
      appId,
      gridId: appId,
      name: appName,
      exe,
      startDir: shortcut.StartDir || "",
      launchOptions: shortcut.LaunchOptions || "",
      libraryPath: "Non-Steam",
      libraryLabel: "Non-Steam",
      type: "non-steam",
      artwork: emptyArtwork()
    };
  });
}

function hydrateArtwork(steamPath, userId, games) {
  const gridDir = path.join(steamPath, "userdata", String(userId), "config", "grid");
  for (const game of games) {
    game.artwork = {
      gridVertical: firstExisting([
        findArtwork(gridDir, `${game.gridId}p`),
        findSteamCacheArtwork(steamPath, game.appId, "library_600x900")
      ]),
      gridHorizontal: firstExisting([
        findArtwork(gridDir, `${game.gridId}`),
        findSteamCacheArtwork(steamPath, game.appId, "library_header")
      ]),
      hero: firstExisting([
        findArtwork(gridDir, `${game.gridId}_hero`),
        findSteamCacheArtwork(steamPath, game.appId, "library_hero")
      ]),
      logo: firstExisting([
        findArtwork(gridDir, `${game.gridId}_logo`),
        findSteamCacheArtwork(steamPath, game.appId, "logo")
      ]),
      icon: firstExisting([
        findArtwork(gridDir, `${game.gridId}_icon`),
        findSteamCacheIcon(steamPath, game.appId)
      ])
    };
  }
}

function findArtwork(gridDir, stem) {
  for (const ext of artworkExtensions) {
    const file = path.join(gridDir, `${stem}${ext}`);
    if (fssync.existsSync(file)) return file;
  }
  return "";
}

function findSteamCacheArtwork(steamPath, appId, stem) {
  if (!appId || !/^\d+$/.test(String(appId))) return "";
  return findArtworkRecursive(path.join(steamPath, "appcache", "librarycache", String(appId)), stem);
}

function findSteamCacheIcon(steamPath, appId) {
  if (!appId || !/^\d+$/.test(String(appId))) return "";
  return findCacheIconRecursive(path.join(steamPath, "appcache", "librarycache", String(appId)));
}

function findArtworkRecursive(dir, stem) {
  let entries;
  try {
    entries = fssync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return "";
  }

  const childDirs = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      childDirs.push(fullPath);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    const fileStem = path.basename(entry.name, ext);
    if (fileStem.toLowerCase() === stem.toLowerCase() && artworkExtensions.includes(ext)) {
      return fullPath;
    }
  }

  for (const childDir of childDirs) {
    const found = findArtworkRecursive(childDir, stem);
    if (found) return found;
  }
  return "";
}

function findCacheIconRecursive(dir) {
  let entries;
  try {
    entries = fssync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return "";
  }

  const childDirs = [];
  let fallback = "";
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      childDirs.push(fullPath);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!artworkExtensions.includes(ext)) continue;
    const stem = path.basename(entry.name, ext).toLowerCase();
    if (stem === "icon" || stem.endsWith("_icon")) return fullPath;
    if (!stem.startsWith("library_") && stem !== "logo" && !fallback) fallback = fullPath;
  }

  if (fallback) return fallback;
  for (const childDir of childDirs) {
    const found = findCacheIconRecursive(childDir);
    if (found) return found;
  }
  return "";
}

function firstExisting(paths) {
  return paths.find(Boolean) || "";
}

function emptyArtwork() {
  return { gridVertical: "", gridHorizontal: "", hero: "", logo: "", icon: "" };
}

async function searchSteamGridDb({ apiKey, query, steamAppId, assetType, tags = [], types = [], mimes = [], dimensions = [] }) {
  if (!apiKey) throw new Error("SteamGridDB API key mancante.");
  const safeAssetType = ["gridVertical", "gridHorizontal", "grids"].includes(assetType) ? "grids" : (["heroes", "logos", "icons"].includes(assetType) ? assetType : "grids");
  const headers = { Authorization: `Bearer ${apiKey}` };
  let game = null;
  let assets = [];

  if (steamAppId) {
    const direct = await sgdbFetch(`/api/v2/${safeAssetType}/steam/${encodeURIComponent(steamAppId)}`, headers, { tags, types, mimes, dimensions });
    if (direct.success) assets = direct.data || [];
  }

  if (!assets.length && query) {
    const search = await sgdbFetch(`/api/v2/search/autocomplete/${encodeURIComponent(query)}`, headers);
    game = search.data?.[0] || null;
    if (game?.id) {
      const byGame = await sgdbFetch(`/api/v2/${safeAssetType}/game/${game.id}`, headers, { tags, types, mimes, dimensions });
      if (byGame.success) assets = byGame.data || [];
    }
  }

  return { game, assets: assets.slice(0, 80) };
}

async function sgdbFetch(route, headers, filters = {}) {
  const params = new URLSearchParams();
  if (filters.tags?.length) params.set("oneoftag", filters.tags.join(","));
  if (filters.types?.length) params.set("types", filters.types.join(","));
  if (filters.mimes?.length) params.set("mimes", filters.mimes.join(","));
  if (filters.dimensions?.length) params.set("dimensions", filters.dimensions.join(","));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`https://www.steamgriddb.com${route}${suffix}`, { headers });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.errors?.[0] || json.error || `SteamGridDB HTTP ${response.status}`);
  }
  return json;
}

async function applyArtwork(body) {
  const { steamPath, userId, gridId, assetType, imageUrl } = body || {};
  if (!steamPath || !userId || !gridId || !imageUrl) throw new Error("Dati mancanti per applicare artwork.");
  const gridDir = path.join(path.resolve(steamPath), "userdata", String(userId), "config", "grid");
  await fs.mkdir(gridDir, { recursive: true });

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Download immagine fallito: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const extFromUrl = path.extname(new URL(imageUrl).pathname).toLowerCase();
  const ext = artworkExtensions.includes(extFromUrl) ? extFromUrl : ".png";
  const filename = artworkFilename(String(gridId), assetType || "grids", ext);
  const target = path.join(gridDir, filename);
  const stem = artworkStem(String(gridId), assetType || "grids");

  await backupAndRemoveExistingArtwork(gridDir, stem);

  await fs.writeFile(target, bytes);
  await mirrorArtworkToSteamCache(path.resolve(steamPath), String(gridId), assetType || "grids", bytes, ext);
  return { ok: true, target };
}

function artworkFilename(gridId, assetType, ext) {
  return `${artworkStem(gridId, assetType)}${ext}`;
}

function artworkStem(gridId, assetType) {
  if (assetType === "gridHorizontal") return gridId;
  if (assetType === "gridVertical") return `${gridId}p`;
  if (assetType === "heroes") return `${gridId}_hero`;
  if (assetType === "logos") return `${gridId}_logo`;
  if (assetType === "icons") return `${gridId}_icon`;
  return `${gridId}p`;
}

async function backupAndRemoveExistingArtwork(gridDir, stem) {
  const existing = artworkExtensions
    .map((ext) => path.join(gridDir, `${stem}${ext}`))
    .filter((file) => fssync.existsSync(file));
  if (!existing.length) return;

  const backupDir = path.join(gridDir, "_sgm_backup");
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const file of existing) {
    await fs.copyFile(file, path.join(backupDir, `${stamp}_${path.basename(file)}`));
    await fs.rm(file);
  }
}

async function mirrorArtworkToSteamCache(steamPath, appId, assetType, bytes, ext) {
  if (!/^\d+$/.test(appId)) return;
  const cacheDir = path.join(steamPath, "appcache", "librarycache", appId);
  if (!fssync.existsSync(cacheDir)) return;

  if (assetType === "logos") {
    const targets = findCacheFiles(cacheDir, (file) => {
      const name = path.basename(file).toLowerCase();
      return name === "logo.png" || name === "logo_2x.png" || name === "logo.jpg" || name === "logo.webp";
    });
    await backupAndOverwriteCacheFiles(cacheDir, targets.length ? targets : [path.join(cacheDir, `logo${ext}`)], bytes);
  }

  if (assetType === "icons") {
    const icon = findCacheIconFile(cacheDir);
    if (icon) {
      await backupAndOverwriteCacheFiles(cacheDir, [icon], bytes);
      const sibling = path.join(path.dirname(icon), `${path.basename(icon, path.extname(icon))}${ext}`);
      if (sibling !== icon) await fs.writeFile(sibling, bytes);
    }
  }
}

function findCacheFiles(dir, predicate) {
  let entries;
  try {
    entries = fssync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findCacheFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function findCacheIconFile(cacheDir) {
  const exact = findCacheFiles(cacheDir, (file) => {
    const stem = path.basename(file, path.extname(file)).toLowerCase();
    return stem === "icon" || stem.endsWith("_icon");
  })[0];
  if (exact) return exact;

  return findCacheFiles(cacheDir, (file) => {
    const ext = path.extname(file).toLowerCase();
    const stem = path.basename(file, ext).toLowerCase();
    return artworkExtensions.includes(ext) && !stem.startsWith("library_") && stem !== "logo" && stem !== "logo_2x" && path.dirname(file) === cacheDir;
  })[0] || "";
}

async function backupAndOverwriteCacheFiles(cacheDir, targets, bytes) {
  if (!targets.length) return;
  const backupDir = path.join(cacheDir, "_sgm_backup");
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const target of targets) {
    if (fssync.existsSync(target)) {
      const relative = path.relative(cacheDir, target).replace(/[\\/]/g, "__");
      await fs.copyFile(target, path.join(backupDir, `${stamp}_${relative}`));
    }
    await fs.writeFile(target, bytes);
  }
}

function csvParam(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseKeyValueVdf(text) {
  const tokens = [...text.matchAll(/"((?:\\"|[^"])*)"|([{}])/g)].map((match) => match[1] ?? match[2]);
  let index = 0;

  function parseObject() {
    const object = {};
    while (index < tokens.length) {
      const key = tokens[index++];
      if (key === "}") break;
      if (tokens[index] === "{") {
        index++;
        object[key] = parseObject();
      } else {
        object[key] = tokens[index++] ?? "";
      }
    }
    return object;
  }

  return parseObject();
}

function parseShortcutsVdf(buffer) {
  const result = [];
  let offset = 0;
  let current = null;

  while (offset < buffer.length) {
    const type = buffer[offset++];
    if (type === 0x00) {
      const name = readCString(buffer, offset);
      offset = name.next;
      if (/^\d+$/.test(name.value)) current = {};
      continue;
    }
    if (type === 0x01 && current) {
      const key = readCString(buffer, offset);
      offset = key.next;
      const value = readCString(buffer, offset);
      offset = value.next;
      current[key.value] = value.value;
      continue;
    }
    if (type === 0x02 && current) {
      const key = readCString(buffer, offset);
      offset = key.next;
      current[key.value] = buffer.readInt32LE(offset);
      offset += 4;
      continue;
    }
    if (type === 0x08) {
      if (current && (current.AppName || current.appname)) result.push(current);
      current = null;
      continue;
    }
    if (type === 0x0b) {
      if (current && (current.AppName || current.appname)) result.push(current);
      current = null;
      continue;
    }
    if (type === 0x09 || type === 0x07) {
      const key = readCString(buffer, offset);
      offset = key.next + (type === 0x09 ? 4 : 8);
      continue;
    }
    if (type === 0x0a) {
      const key = readCString(buffer, offset);
      offset = key.next;
      continue;
    }
    break;
  }

  return result;
}

function readCString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end++;
  return { value: buffer.toString("utf8", offset, end), next: end + 1 };
}

function computeShortcutAppId(exe, appName) {
  return (crc32(`${exe}${appName}`) | 0x80000000) >>> 0;
}

function crc32(input) {
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i);
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function readTextOptional(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function readBufferOptional(file) {
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

async function listFilesOptional(dir, pattern) {
  try {
    return (await fs.readdir(dir)).filter((name) => pattern.test(name));
  } catch {
    return [];
  }
}

async function listDirsOptional(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function byName(a, b) {
  return a.name.localeCompare(b.name, "it", { sensitivity: "base" });
}

function driveLabel(libraryPath) {
  const parsed = path.parse(path.resolve(libraryPath));
  return `${parsed.root.replace("\\", "") || libraryPath} ${path.basename(libraryPath) || "Steam"}`.trim();
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, data) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(data);
}
