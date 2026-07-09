const ASSETS = {
  gridVertical: {
    label: "Grid verticale",
    key: "gridVertical",
    previewId: "previewGridVertical",
    dimensions: ["600x900", "342x482"]
  },
  gridHorizontal: {
    label: "Grid orizzontale",
    key: "gridHorizontal",
    previewId: "previewGridHorizontal",
    dimensions: ["920x430", "460x215"]
  },
  heroes: {
    label: "Hero",
    key: "hero",
    previewId: "previewHero",
    dimensions: ["1920x620", "3840x1240"]
  },
  logos: {
    label: "Logo",
    key: "logo",
    previewId: "previewLogo",
    dimensions: []
  },
  icons: {
    label: "Icona",
    key: "icon",
    previewId: "previewIcon",
    dimensions: ["512x512", "256x256", "128x128", "32x32"]
  }
};

const state = {
  steamPath: "C:\\Program Files (x86)\\Steam",
  selectedUserId: "",
  selectedLibrary: "all",
  selectedType: "all",
  selectedGame: null,
  assetType: "gridVertical",
  games: [],
  libraries: [],
  accounts: []
};

const els = {
  steamPath: document.querySelector("#steamPath"),
  apiKey: document.querySelector("#apiKey"),
  steamApiKey: document.querySelector("#steamApiKey"),
  includeOwnedLibrary: document.querySelector("#includeOwnedLibrary"),
  saveSettings: document.querySelector("#saveSettings"),
  showApiKey: document.querySelector("#showApiKey"),
  settingsStatus: document.querySelector("#settingsStatus"),
  syncTitle: document.querySelector("#syncTitle"),
  syncSubtitle: document.querySelector("#syncSubtitle"),
  scanButton: document.querySelector("#scanButton"),
  activeAccount: document.querySelector("#activeAccount"),
  libraryNav: document.querySelector("#libraryNav"),
  gameSearch: document.querySelector("#gameSearch"),
  typeFilter: document.querySelector("#typeFilter"),
  gameGrid: document.querySelector("#gameGrid"),
  steamCount: document.querySelector("#steamCount"),
  nonSteamCount: document.querySelector("#nonSteamCount"),
  libraryCount: document.querySelector("#libraryCount"),
  heroTitle: document.querySelector("#heroTitle"),
  heroSubtitle: document.querySelector("#heroSubtitle"),
  gameModal: document.querySelector("#gameModal"),
  closeModal: document.querySelector("#closeModal"),
  selectedType: document.querySelector("#selectedType"),
  selectedName: document.querySelector("#selectedName"),
  selectedMeta: document.querySelector("#selectedMeta"),
  filterStatic: document.querySelector("#filterStatic"),
  filterAnimated: document.querySelector("#filterAnimated"),
  filterNsfw: document.querySelector("#filterNsfw"),
  filterHumor: document.querySelector("#filterHumor"),
  filterEpilepsy: document.querySelector("#filterEpilepsy"),
  filterUntagged: document.querySelector("#filterUntagged"),
  dimensionFilter: document.querySelector("#dimensionFilter"),
  searchArtwork: document.querySelector("#searchArtwork"),
  artworkStatus: document.querySelector("#artworkStatus"),
  artworkGrid: document.querySelector("#artworkGrid")
};

els.scanButton.addEventListener("click", scan);
els.gameSearch.addEventListener("input", renderGames);
els.typeFilter.addEventListener("change", () => {
  state.selectedType = els.typeFilter.value;
  renderGames();
});
els.searchArtwork.addEventListener("click", searchArtwork);
els.saveSettings.addEventListener("click", saveSettings);
els.closeModal.addEventListener("click", closeGameModal);
els.gameModal.addEventListener("click", (event) => {
  if (event.target === els.gameModal) closeGameModal();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.gameModal.classList.contains("hidden")) closeGameModal();
});
els.showApiKey.addEventListener("change", () => {
  els.apiKey.type = els.showApiKey.checked ? "text" : "password";
  els.steamApiKey.type = els.showApiKey.checked ? "text" : "password";
});
els.steamPath.addEventListener("change", () => {
  state.steamPath = els.steamPath.value || state.steamPath;
  setSettingsStatus("Da salvare");
});
els.apiKey.addEventListener("input", () => setSettingsStatus("Da salvare"));
els.steamApiKey.addEventListener("input", () => setSettingsStatus("Da salvare"));
els.includeOwnedLibrary.addEventListener("change", () => setSettingsStatus("Da salvare"));
els.dimensionFilter.addEventListener("change", () => {
  if (state.selectedGame) els.artworkStatus.textContent = "";
});

document.querySelectorAll(".asset-tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".asset-tab").forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    state.assetType = button.dataset.asset;
    renderDimensionOptions();
    els.artworkGrid.innerHTML = "";
    els.artworkStatus.textContent = "";
  });
});

initApp();

async function initApp() {
  renderDimensionOptions();
  await loadSettings();
  await scan();
}

async function loadSettings() {
  try {
    const settings = await settingsBackend("load_settings");
    els.apiKey.value = settings.apiKey || "";
    els.steamApiKey.value = settings.steamApiKey || "";
    els.includeOwnedLibrary.checked = Boolean(settings.includeOwnedLibrary);
    els.steamPath.value = settings.steamPath || state.steamPath;
    state.steamPath = els.steamPath.value;
    setSettingsStatus(settings.apiKey ? "Key salvata" : "Key assente");
  } catch (error) {
    setSettingsStatus("Impostazioni non caricate");
  }
}

async function saveSettings() {
  setSettingsStatus("Salvataggio...");
  try {
    const settings = {
      apiKey: els.apiKey.value.trim(),
      steamApiKey: els.steamApiKey.value.trim(),
      includeOwnedLibrary: els.includeOwnedLibrary.checked,
      steamPath: els.steamPath.value.trim() || state.steamPath
    };
    const saved = await settingsBackend("save_settings", { settings });
    els.apiKey.value = saved.apiKey || "";
    els.steamApiKey.value = saved.steamApiKey || "";
    els.includeOwnedLibrary.checked = Boolean(saved.includeOwnedLibrary);
    els.steamPath.value = saved.steamPath || settings.steamPath;
    state.steamPath = els.steamPath.value;
    setSettingsStatus("Salvato");
    setSync("Impostazioni salvate", "API key e path Steam sono persistenti");
  } catch (error) {
    setSettingsStatus("Errore");
    setSync("Salvataggio fallito", error.message);
  }
}

async function scan() {
  state.steamPath = els.steamPath.value || state.steamPath;
  setBusy(true, "Scansione Steam in corso...");
  try {
    const scanUserId = state.selectedUserId && state.selectedUserId !== "0" ? state.selectedUserId : "";
    const wantsOwnedLibrary = els.includeOwnedLibrary.checked;
    const steamApiKey = els.steamApiKey.value.trim();
    const data = await callBackend(
      "scan_steam",
      {
        options: {
          steamPath: state.steamPath,
          userId: scanUserId,
          steamApiKey,
          includeOwnedLibrary: wantsOwnedLibrary
        }
      },
      `/api/steam/scan?steamPath=${encodeURIComponent(state.steamPath)}&userId=${encodeURIComponent(scanUserId)}&steamApiKey=${encodeURIComponent(steamApiKey)}&includeOwnedLibrary=${wantsOwnedLibrary ? "1" : "0"}`
    );
    state.games = data.games || [];
    state.libraries = data.libraries || [];
    state.accounts = data.accounts || [];
    state.selectedUserId = data.selectedUserId || "";
    els.steamCount.textContent = data.counts?.steam ?? 0;
    els.nonSteamCount.textContent = data.counts?.nonSteam ?? 0;
    els.libraryCount.textContent = data.counts?.libraries ?? 0;
    if (state.selectedGame) {
      state.selectedGame = state.games.find((game) => game.id === state.selectedGame.id) || null;
    }
    renderAccounts();
    renderLibraries();
    renderGames();
    if (state.selectedGame) renderModal();
    setHero("Libreria scansionata", `${state.games.length} giochi trovati in ${state.libraries.length} librerie.`);
    if (wantsOwnedLibrary && !steamApiKey) {
      setSync("Steam API key mancante", "Aggiungila nelle impostazioni e salva");
    } else if (wantsOwnedLibrary && data.ownedLibraryStatus?.startsWith("error:")) {
      setSync("Steam Web API errore", data.ownedLibraryStatus.slice(6));
    } else if (wantsOwnedLibrary) {
      setSync("Steam Web API ok", `${data.counts?.owned ?? 0} giochi non installati trovati`);
    } else {
      setSync("Sincronizzato", `${data.counts?.steam ?? 0} Steam, ${data.counts?.owned ?? 0} non installati, ${data.counts?.nonSteam ?? 0} non-Steam`);
    }
  } catch (error) {
    setHero("Scansione non riuscita", error.message);
    setSync("Scansione fallita", error.message);
  } finally {
    setBusy(false);
  }
}

function renderAccounts() {
  const active = state.accounts.find((account) => account.id === state.selectedUserId);
  if (!active) {
    els.activeAccount.textContent = "Nessun profilo";
    return;
  }
  const name = active.personaName || active.accountName || active.id;
  els.activeAccount.textContent = `${name} (${active.id})`;
  els.activeAccount.title = active.path;
}

function renderLibraries() {
  const items = [
    { id: "all", label: "Tutte le librerie", count: state.games.length },
    ...state.libraries.map((library) => ({
      id: library.path,
      label: library.label,
      count: state.games.filter((game) => game.libraryPath === library.path).length
    })),
    { id: "Owned", label: "Non installati", count: state.games.filter((game) => game.type === "owned").length },
    { id: "Non-Steam", label: "Non-Steam", count: state.games.filter((game) => game.type === "non-steam").length }
  ];

  els.libraryNav.innerHTML = items.map((item) => `
    <button class="nav-item ${item.id === state.selectedLibrary ? "active" : ""}" data-library="${escapeAttr(item.id)}">
      <span>${escapeHtml(item.label)}</span>
      <small>${item.count}</small>
    </button>
  `).join("");

  els.libraryNav.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedLibrary = button.dataset.library;
      renderLibraries();
      renderGames();
    });
  });
}

function renderGames() {
  const search = els.gameSearch.value.trim().toLowerCase();
  const games = state.games.filter((game) => {
    const libraryOk = state.selectedLibrary === "all" || game.libraryPath === state.selectedLibrary;
    const typeOk = state.selectedType === "all" || game.type === state.selectedType;
    const searchOk = !search || game.name.toLowerCase().includes(search);
    return libraryOk && typeOk && searchOk;
  });

  els.gameGrid.innerHTML = games.map((game) => {
    const poster = game.artwork?.gridVertical || game.artwork?.gridHorizontal || "";
    return `
      <article class="game-card ${state.selectedGame?.id === game.id ? "active" : ""}" data-id="${escapeAttr(game.id)}">
        <div class="poster ${poster ? "has-artwork" : ""}">${poster ? `<img src="${escapeAttr(localArtworkUrl(poster))}" alt="">` : `<span>${escapeHtml(initials(game.name))}</span>`}</div>
        <footer>
          <strong>${escapeHtml(game.name)}</strong>
          <small>${escapeHtml(game.libraryLabel)}</small>
        </footer>
      </article>
    `;
  }).join("");

  els.gameGrid.querySelectorAll(".game-card").forEach((card) => {
    card.addEventListener("click", () => openGameModal(card.dataset.id));
  });
}

function openGameModal(gameId) {
  state.selectedGame = state.games.find((game) => game.id === gameId) || null;
  if (!state.selectedGame) return;
  els.gameModal.classList.remove("hidden");
  renderGames();
  renderModal();
}

function closeGameModal() {
  els.gameModal.classList.add("hidden");
  els.artworkGrid.innerHTML = "";
  els.artworkStatus.textContent = "";
}

function renderModal() {
  const game = state.selectedGame;
  if (!game) return;
  els.selectedType.textContent = game.type === "non-steam" ? `Non-Steam ID ${game.gridId}` : `Steam AppID ${game.appId}`;
  els.selectedName.textContent = game.name;
  els.selectedMeta.textContent = game.type === "owned" ? "Non installato" : (game.libraryPath || game.exe || "Shortcut locale");
  renderExistingArtwork(game);
}

function renderExistingArtwork(game) {
  Object.entries(ASSETS).forEach(([assetType, config]) => {
    const frame = document.querySelector(`#${config.previewId}`);
    const preview = frame.closest(".asset-preview");
    const value = game.artwork?.[config.key] || "";
    const label = value ? `${config.label} presente` : `${config.label} assente`;
    preview.classList.toggle("present", Boolean(value));
    preview.querySelector("strong").textContent = config.label;
    preview.querySelector("small").textContent = label;
    frame.innerHTML = value
      ? `<img src="${escapeAttr(localArtworkUrl(value))}" alt="">`
      : `<span>${escapeHtml(assetPlaceholder(assetType, game.name))}</span>`;
  });
}

function renderDimensionOptions() {
  const dimensions = ASSETS[state.assetType]?.dimensions || [];
  els.dimensionFilter.innerHTML = [
    `<option value="">Dimensioni automatiche</option>`,
    ...dimensions.map((dimension) => `<option value="${escapeAttr(dimension)}">${escapeHtml(dimension)}</option>`)
  ].join("");
}

async function searchArtwork() {
  const game = state.selectedGame;
  const apiKey = els.apiKey.value.trim();
  if (!game) return;
  if (!apiKey) {
    els.artworkStatus.textContent = "Inserisci la API key di SteamGridDB.";
    return;
  }

  const filters = buildSgdbFilters();
  els.artworkStatus.textContent = `Ricerca ${assetLabel(state.assetType).toLowerCase()}...`;
  els.artworkGrid.innerHTML = "";
  try {
    const params = new URLSearchParams({
      apiKey,
      q: game.name,
      assetType: state.assetType
    });
    if (game.type === "steam" || game.type === "owned") params.set("steamAppId", game.appId);
    if (filters.tags.length) params.set("tags", filters.tags.join(","));
    if (filters.types.length) params.set("types", filters.types.join(","));
    if (filters.mimes.length) params.set("mimes", filters.mimes.join(","));
    if (filters.dimensions.length) params.set("dimensions", filters.dimensions.join(","));
    const data = await callBackend(
      "search_steam_grid_db",
      {
        options: {
          apiKey,
          query: game.name,
          steamAppId: game.type === "steam" || game.type === "owned" ? game.appId : "",
          assetType: state.assetType,
          tags: filters.tags,
          types: filters.types,
          mimes: filters.mimes,
          dimensions: filters.dimensions
        }
      },
      `/api/sgdb/search?${params.toString()}`
    );
    renderArtwork(data.assets || []);
    els.artworkStatus.textContent = data.assets?.length ? `${data.assets.length} risultati` : "Nessun artwork trovato.";
  } catch (error) {
    els.artworkStatus.textContent = error.message;
  }
}

function buildSgdbFilters() {
  const tags = [];
  const types = [];
  const mimes = [];
  const dimensions = [];
  if (els.filterNsfw.checked) tags.push("nsfw");
  if (els.filterHumor.checked) tags.push("humor");
  if (els.filterEpilepsy.checked) tags.push("epilepsy");
  if (els.filterUntagged.checked) tags.push("untagged");
  if (els.filterStatic.checked) types.push("static");
  if (els.filterAnimated.checked) types.push("animated");
  if (els.filterAnimated.checked && state.assetType !== "icons") mimes.push("image/webp");
  if (els.dimensionFilter.value) dimensions.push(els.dimensionFilter.value);
  return { tags, types, mimes, dimensions };
}

function renderArtwork(assets) {
  els.artworkGrid.innerHTML = assets.map((asset, index) => `
    <article class="art-card" data-index="${index}" data-asset="${escapeAttr(state.assetType)}">
      <img src="${escapeAttr(asset.thumb || asset.url)}" alt="">
      <button data-index="${index}">Applica</button>
    </article>
  `).join("");

  els.artworkGrid.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      const asset = assets[Number(button.dataset.index)];
      await applyArtwork(asset.url);
    });
  });
}

async function applyArtwork(imageUrl) {
  const game = state.selectedGame;
  if (!game) return;
  els.artworkStatus.textContent = "Applicazione artwork...";
  try {
    const body = {
      steamPath: state.steamPath,
      userId: state.selectedUserId,
      gridId: game.gridId,
      assetType: state.assetType,
      imageUrl
    };
    const result = await callBackend("apply_artwork", { request: body }, "/api/artwork/apply", body);
    updateSelectedArtwork(result.target);
    els.artworkStatus.textContent = `${assetLabel(state.assetType)} applicata`;
    els.artworkStatus.title = result.target || "";
  } catch (error) {
    els.artworkStatus.textContent = error.message;
    els.artworkStatus.title = error.message;
  }
}

function updateSelectedArtwork(target) {
  if (!state.selectedGame || !target) return;
  const key = ASSETS[state.assetType]?.key || "gridVertical";
  state.selectedGame.artwork = state.selectedGame.artwork || {};
  state.selectedGame.artwork[key] = target;
  const game = state.games.find((item) => item.id === state.selectedGame.id);
  if (game) game.artwork = state.selectedGame.artwork;
  renderModal();
  renderGames();
}

function assetLabel(assetType) {
  return ASSETS[assetType]?.label || "Artwork";
}

function assetPlaceholder(assetType, name) {
  if (assetType === "logos") return "Logo";
  if (assetType === "icons") return "Icona";
  if (assetType === "heroes") return "Hero";
  return initials(name);
}

async function callBackend(command, tauriArgs, httpUrl, httpBody) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    return invoke(command, tauriArgs);
  }
  return httpBody ? postJson(httpUrl, httpBody) : getJson(httpUrl);
}

async function settingsBackend(command, args = {}) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    return invoke(command, args);
  }

  if (command === "load_settings") {
    return {
      apiKey: localStorage.getItem("sgm.apiKey") || "",
      steamApiKey: localStorage.getItem("sgm.steamApiKey") || "",
      includeOwnedLibrary: localStorage.getItem("sgm.includeOwnedLibrary") === "1",
      steamPath: localStorage.getItem("sgm.steamPath") || state.steamPath
    };
  }

  const settings = args.settings || {};
  localStorage.setItem("sgm.apiKey", settings.apiKey || "");
  localStorage.setItem("sgm.steamApiKey", settings.steamApiKey || "");
  localStorage.setItem("sgm.includeOwnedLibrary", settings.includeOwnedLibrary ? "1" : "0");
  localStorage.setItem("sgm.steamPath", settings.steamPath || state.steamPath);
  return {
    apiKey: settings.apiKey || "",
    steamApiKey: settings.steamApiKey || "",
    includeOwnedLibrary: Boolean(settings.includeOwnedLibrary),
    steamPath: settings.steamPath || state.steamPath
  };
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function setBusy(isBusy, label = "Scansiona") {
  els.scanButton.disabled = isBusy;
  els.scanButton.textContent = isBusy ? label : "Scansiona";
}

function setHero(title, subtitle) {
  els.heroTitle.textContent = title;
  els.heroSubtitle.textContent = subtitle;
}

function setSync(title, subtitle) {
  els.syncTitle.textContent = title;
  els.syncSubtitle.textContent = subtitle;
}

function setSettingsStatus(text) {
  els.settingsStatus.textContent = text;
}

function localArtworkUrl(filePath) {
  const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
  if (convertFileSrc) {
    return convertFileSrc(filePath);
  }
  return `/api/artwork/local?path=${encodeURIComponent(filePath)}`;
}

function initials(name) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("") : name.slice(0, 3)).toUpperCase();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
