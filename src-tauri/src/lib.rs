use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_STEAM_PATH: &str = "C:\\Program Files (x86)\\Steam";

#[derive(Debug, Serialize)]
struct Library {
    id: String,
    path: String,
    label: String,
    #[serde(rename = "totalSize")]
    total_size: String,
    #[serde(rename = "updateCleanBytesTally")]
    update_clean_bytes_tally: String,
}

#[derive(Debug, Serialize)]
struct Account {
    id: String,
    #[serde(rename = "steamId64")]
    steam_id64: String,
    path: String,
    #[serde(rename = "accountName")]
    account_name: String,
    #[serde(rename = "personaName")]
    persona_name: String,
    #[serde(rename = "mostRecent")]
    most_recent: bool,
    #[serde(rename = "hasGrid")]
    has_grid: bool,
    #[serde(rename = "hasShortcuts")]
    has_shortcuts: bool,
}

#[derive(Debug, Serialize)]
struct Game {
    id: String,
    #[serde(rename = "appId")]
    app_id: String,
    #[serde(rename = "gridId")]
    grid_id: String,
    name: String,
    #[serde(rename = "installDir")]
    install_dir: String,
    exe: String,
    #[serde(rename = "startDir")]
    start_dir: String,
    #[serde(rename = "launchOptions")]
    launch_options: String,
    #[serde(rename = "libraryPath")]
    library_path: String,
    #[serde(rename = "libraryLabel")]
    library_label: String,
    #[serde(rename = "type")]
    game_type: String,
    artwork: Artwork,
}

#[derive(Debug, Default, Serialize)]
struct Artwork {
    #[serde(rename = "gridVertical")]
    grid_vertical: String,
    #[serde(rename = "gridHorizontal")]
    grid_horizontal: String,
    hero: String,
    logo: String,
    icon: String,
}

#[derive(Debug, Serialize)]
struct ScanCounts {
    steam: usize,
    owned: usize,
    #[serde(rename = "nonSteam")]
    non_steam: usize,
    libraries: usize,
    accounts: usize,
}

#[derive(Debug, Serialize)]
struct ScanResult {
    #[serde(rename = "steamPath")]
    steam_path: String,
    libraries: Vec<Library>,
    accounts: Vec<Account>,
    #[serde(rename = "selectedUserId")]
    selected_user_id: String,
    games: Vec<Game>,
    counts: ScanCounts,
    #[serde(rename = "ownedLibraryStatus")]
    owned_library_status: String,
}

#[derive(Debug, Deserialize)]
struct ApplyArtworkRequest {
    #[serde(rename = "steamPath")]
    steam_path: String,
    #[serde(rename = "userId")]
    user_id: String,
    #[serde(rename = "gridId")]
    grid_id: String,
    #[serde(rename = "assetType")]
    asset_type: String,
    #[serde(rename = "imageUrl")]
    image_url: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct SgdbSearchOptions {
    #[serde(rename = "apiKey")]
    api_key: String,
    query: String,
    #[serde(rename = "steamAppId")]
    steam_app_id: String,
    #[serde(rename = "assetType")]
    asset_type: String,
    tags: Vec<String>,
    types: Vec<String>,
    mimes: Vec<String>,
    dimensions: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct ScanOptions {
    #[serde(rename = "steamPath")]
    steam_path: String,
    #[serde(rename = "userId")]
    user_id: String,
    #[serde(rename = "steamApiKey")]
    steam_api_key: String,
    #[serde(rename = "includeOwnedLibrary")]
    include_owned_library: bool,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default)]
struct AppSettings {
    #[serde(rename = "apiKey")]
    api_key: String,
    #[serde(rename = "steamApiKey")]
    steam_api_key: String,
    #[serde(rename = "includeOwnedLibrary")]
    include_owned_library: bool,
    #[serde(rename = "steamPath")]
    steam_path: String,
}

#[tauri::command]
fn load_settings() -> Result<AppSettings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings {
            steam_path: DEFAULT_STEAM_PATH.to_string(),
            ..Default::default()
        });
    }

    let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut settings = serde_json::from_str::<AppSettings>(&text).map_err(|err| err.to_string())?;
    if settings.steam_path.trim().is_empty() {
        settings.steam_path = DEFAULT_STEAM_PATH.to_string();
    }
    Ok(settings)
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<AppSettings, String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let settings = AppSettings {
        api_key: settings.api_key.trim().to_string(),
        steam_api_key: settings.steam_api_key.trim().to_string(),
        include_owned_library: settings.include_owned_library,
        steam_path: if settings.steam_path.trim().is_empty() {
            DEFAULT_STEAM_PATH.to_string()
        } else {
            settings.steam_path.trim().to_string()
        },
    };
    let text = serde_json::to_string_pretty(&settings).map_err(|err| err.to_string())?;
    fs::write(path, text).map_err(|err| err.to_string())?;
    Ok(settings)
}

#[tauri::command]
async fn scan_steam(options: ScanOptions) -> Result<ScanResult, String> {
    let steam_path = PathBuf::from(if options.steam_path.trim().is_empty() {
        DEFAULT_STEAM_PATH.to_string()
    } else {
        options.steam_path
    });
    let library_file = steam_path.join("steamapps").join("libraryfolders.vdf");
    let parsed_libraries = fs::read_to_string(library_file)
        .ok()
        .and_then(|text| parse_key_value_vdf(&text).remove("libraryfolders"))
        .unwrap_or(Value::Object(Default::default()));

    let libraries = collect_libraries(&parsed_libraries, &steam_path);
    let mut steam_games = Vec::new();

    for library in &libraries {
        let steamapps = Path::new(&library.path).join("steamapps");
        let Ok(entries) = fs::read_dir(steamapps) else {
            continue;
        };

        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if !file_name.starts_with("appmanifest_") || !file_name.ends_with(".acf") {
                continue;
            }

            let Ok(text) = fs::read_to_string(entry.path()) else {
                continue;
            };
            let parsed = parse_key_value_vdf(&text);
            let Some(app_state) = parsed.get("AppState").and_then(Value::as_object) else {
                continue;
            };
            let Some(appid) = app_state.get("appid").and_then(Value::as_str) else {
                continue;
            };
            let name = app_state
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Steam game")
                .to_string();

            steam_games.push(Game {
                id: appid.to_string(),
                app_id: appid.to_string(),
                grid_id: appid.to_string(),
                name,
                install_dir: app_state
                    .get("installdir")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                exe: String::new(),
                start_dir: String::new(),
                launch_options: String::new(),
                library_path: library.path.clone(),
                library_label: library.label.clone(),
                game_type: "steam".to_string(),
                artwork: Artwork::default(),
            });
        }
    }

    let accounts = scan_accounts(&steam_path);
    let requested_user_id = options.user_id;
    let selected_user_id = if !requested_user_id.trim().is_empty()
        && requested_user_id != "0"
        && accounts.iter().any(|account| account.id == requested_user_id)
    {
        requested_user_id
    } else {
        pick_active_account(&accounts)
    };
    let mut non_steam_games = if selected_user_id.is_empty() {
        Vec::new()
    } else {
        scan_shortcuts(&steam_path, &selected_user_id)
    };
    let mut owned_library_status = "disabled".to_string();
    let mut owned_games = if options.include_owned_library {
        let steam_id64 = accounts
            .iter()
            .find(|account| account.id == selected_user_id)
            .and_then(|account| account.steam_id64.parse::<u64>().ok());
        match fetch_owned_games(options.steam_api_key, steam_id64, &steam_games).await {
            Ok(games) => {
                owned_library_status = format!("ok:{}", games.len());
                games
            }
            Err(error) => {
                owned_library_status = format!("error:{}", error);
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };

    steam_games.sort_by_key(|game| game.name.to_lowercase());
    owned_games.sort_by_key(|game| game.name.to_lowercase());
    non_steam_games.sort_by_key(|game| game.name.to_lowercase());
    let steam_count = steam_games.len();
    let owned_count = owned_games.len();
    let non_steam_count = non_steam_games.len();
    let mut games = steam_games;
    games.append(&mut owned_games);
    games.append(&mut non_steam_games);
    hydrate_artwork(&steam_path, &selected_user_id, &mut games);

    Ok(ScanResult {
        steam_path: steam_path.to_string_lossy().to_string(),
        counts: ScanCounts {
            steam: steam_count,
            owned: owned_count,
            non_steam: non_steam_count,
            libraries: libraries.len(),
            accounts: accounts.len(),
        },
        libraries,
        accounts,
        selected_user_id,
        games,
        owned_library_status,
    })
}

#[tauri::command]
async fn search_steam_grid_db(options: SgdbSearchOptions) -> Result<Value, String> {
    if options.api_key.trim().is_empty() {
        return Err("SteamGridDB API key mancante.".to_string());
    }

    let safe_asset_type = match options.asset_type.as_str() {
        "gridVertical" | "gridHorizontal" | "grids" => "grids".to_string(),
        "heroes" | "logos" | "icons" => options.asset_type.clone(),
        _ => "grids".to_string(),
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", options.api_key)).map_err(|err| err.to_string())?,
    );
    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|err| err.to_string())?;

    let mut game = Value::Null;
    let mut assets = Vec::new();

    if !options.steam_app_id.trim().is_empty() {
        let route = format!(
            "https://www.steamgriddb.com/api/v2/{}/steam/{}",
            safe_asset_type, options.steam_app_id
        );
        if let Ok(value) = sgdb_get(&client, &route, &options.tags, &options.types, &options.mimes, &options.dimensions).await {
            assets = value
                .get("data")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
        }
    }

    if assets.is_empty() && !options.query.trim().is_empty() {
        let route = format!(
            "https://www.steamgriddb.com/api/v2/search/autocomplete/{}",
            options.query.replace(' ', "%20")
        );
        let search = sgdb_get(&client, &route, &[], &[], &[], &[]).await?;
        game = search
            .get("data")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .cloned()
            .unwrap_or(Value::Null);

        if let Some(game_id) = game.get("id").and_then(Value::as_i64) {
            let route = format!(
                "https://www.steamgriddb.com/api/v2/{}/game/{}",
                safe_asset_type, game_id
            );
            let by_game = sgdb_get(&client, &route, &options.tags, &options.types, &options.mimes, &options.dimensions).await?;
            assets = by_game
                .get("data")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
        }
    }

    Ok(json!({ "game": game, "assets": assets.into_iter().take(80).collect::<Vec<_>>() }))
}

#[tauri::command]
async fn apply_artwork(request: ApplyArtworkRequest) -> Result<Value, String> {
    let grid_dir = PathBuf::from(&request.steam_path)
        .join("userdata")
        .join(&request.user_id)
        .join("config")
        .join("grid");
    fs::create_dir_all(&grid_dir).map_err(|err| err.to_string())?;

    let response = reqwest::get(&request.image_url)
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download immagine fallito: HTTP {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    let ext = image_ext_from_url(&request.image_url);
    let filename = artwork_filename(&request.grid_id, &request.asset_type, ext);
    let target = grid_dir.join(filename);
    let stem = artwork_stem(&request.grid_id, &request.asset_type);

    backup_and_remove_existing_artwork(&grid_dir, &stem)?;

    fs::write(&target, bytes).map_err(|err| err.to_string())?;
    Ok(json!({ "ok": true, "target": target.to_string_lossy() }))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            scan_steam,
            search_steam_grid_db,
            apply_artwork
        ])
        .run(tauri::generate_context!())
        .expect("error while running Steam Grid Manager");
}

fn settings_path() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA non disponibile.".to_string())?;
    Ok(PathBuf::from(appdata)
        .join("Steam Grid Manager")
        .join("settings.json"))
}

async fn sgdb_get(
    client: &reqwest::Client,
    url: &str,
    tags: &[String],
    types: &[String],
    mimes: &[String],
    dimensions: &[String],
) -> Result<Value, String> {
    let mut request = client.get(url);
    let mut query = Vec::new();
    if !tags.is_empty() {
        query.push(("oneoftag", tags.join(",")));
    }
    if !types.is_empty() {
        query.push(("types", types.join(",")));
    }
    if !mimes.is_empty() {
        query.push(("mimes", mimes.join(",")));
    }
    if !dimensions.is_empty() {
        query.push(("dimensions", dimensions.join(",")));
    }
    if !query.is_empty() {
        request = request.query(&query);
    }
    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    let value = response.json::<Value>().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(value
            .get("errors")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(Value::as_str)
            .unwrap_or("Errore SteamGridDB")
            .to_string());
    }
    Ok(value)
}

fn collect_libraries(parsed: &Value, steam_path: &Path) -> Vec<Library> {
    let mut libraries = BTreeMap::new();
    libraries.insert(
        steam_path.to_string_lossy().to_lowercase(),
        Library {
            id: "0".to_string(),
            path: steam_path.to_string_lossy().to_string(),
            label: drive_label(steam_path),
            total_size: String::new(),
            update_clean_bytes_tally: String::new(),
        },
    );

    if let Some(object) = parsed.as_object() {
        for (id, value) in object {
            let Some(entry) = value.as_object() else {
                continue;
            };
            let Some(library_path) = entry.get("path").and_then(Value::as_str) else {
                continue;
            };
            let normalized = PathBuf::from(library_path.replace("\\\\", "\\"));
            libraries.insert(
                normalized.to_string_lossy().to_lowercase(),
                Library {
                    id: id.clone(),
                    path: normalized.to_string_lossy().to_string(),
                    label: drive_label(&normalized),
                    total_size: entry
                        .get("totalsize")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    update_clean_bytes_tally: entry
                        .get("update_clean_bytes_tally")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                },
            );
        }
    }

    libraries.into_values().collect()
}

fn scan_accounts(steam_path: &Path) -> Vec<Account> {
    let userdata = steam_path.join("userdata");
    let login_users = scan_login_users(steam_path);
    let mut accounts = fs::read_dir(userdata)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let id = entry.file_name().to_string_lossy().to_string();
            if !id.chars().all(|char| char.is_ascii_digit()) {
                return None;
            }
            let config = entry.path().join("config");
            let login = login_users.get(&id);
            Some(Account {
                id: id.clone(),
                steam_id64: login
                    .and_then(|value| value.get("SteamID64"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                path: entry.path().to_string_lossy().to_string(),
                account_name: login
                    .and_then(|value| value.get("AccountName"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                persona_name: login
                    .and_then(|value| value.get("PersonaName"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                most_recent: login
                    .and_then(|value| value.get("MostRecent"))
                    .and_then(Value::as_str)
                    .is_some_and(|value| value == "1"),
                has_grid: config.join("grid").exists(),
                has_shortcuts: config.join("shortcuts.vdf").exists(),
            })
        })
        .collect::<Vec<_>>();

    accounts.sort_by(|a, b| {
        if a.id == "0" {
            return std::cmp::Ordering::Greater;
        }
        if b.id == "0" {
            return std::cmp::Ordering::Less;
        }
        b.most_recent
            .cmp(&a.most_recent)
            .then_with(|| b.has_grid.cmp(&a.has_grid))
            .then_with(|| b.has_shortcuts.cmp(&a.has_shortcuts))
            .then_with(|| a.id.cmp(&b.id))
    });
    accounts
}

fn scan_login_users(steam_path: &Path) -> BTreeMap<String, Value> {
    let login_file = steam_path.join("config").join("loginusers.vdf");
    let Ok(text) = fs::read_to_string(login_file) else {
        return BTreeMap::new();
    };
    let parsed = parse_key_value_vdf(&text);
    let Some(users) = parsed.get("users").and_then(Value::as_object) else {
        return BTreeMap::new();
    };
    users
        .iter()
        .filter_map(|(steam_id64, value)| {
            steam_id64_to_account_id(steam_id64).map(|id| {
                let mut value = value.clone();
                if let Some(object) = value.as_object_mut() {
                    object.insert("SteamID64".to_string(), Value::String(steam_id64.clone()));
                }
                (id, value)
            })
        })
        .collect()
}

async fn fetch_owned_games(
    api_key: String,
    steam_id64: Option<u64>,
    installed_games: &[Game],
) -> Result<Vec<Game>, String> {
    let api_key = api_key.trim();
    let Some(steam_id64) = steam_id64 else {
        return Ok(Vec::new());
    };
    if api_key.is_empty() {
        return Err("Steam Web API key mancante".to_string());
    }

    let installed = installed_games
        .iter()
        .map(|game| game.app_id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let url = format!(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={}&steamid={}&include_appinfo=true&include_played_free_games=true&include_free_sub=true&format=json",
        api_key, steam_id64
    );
    let value = reqwest::get(url)
        .await
        .map_err(|err| format!("Steam Web API non raggiungibile: {}", err))?
        .json::<Value>()
        .await
        .map_err(|err| format!("Risposta Steam Web API non valida: {}", err))?;

    let games = value
        .get("response")
        .and_then(|response| response.get("games"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(games
        .into_iter()
        .filter_map(|item| {
            let app_id = item.get("appid").and_then(Value::as_i64)?.to_string();
            if installed.contains(app_id.as_str()) {
                return None;
            }
            Some(Game {
                id: format!("owned:{}", app_id),
                app_id: app_id.clone(),
                grid_id: app_id,
                name: item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Steam game")
                    .to_string(),
                install_dir: String::new(),
                exe: String::new(),
                start_dir: String::new(),
                launch_options: String::new(),
                library_path: "Owned".to_string(),
                library_label: "Non installato".to_string(),
                game_type: "owned".to_string(),
                artwork: Artwork::default(),
            })
        })
        .collect())
}

fn steam_id64_to_account_id(steam_id64: &str) -> Option<String> {
    let id = steam_id64.parse::<u64>().ok()?;
    id.checked_sub(76561197960265728)
        .map(|account_id| account_id.to_string())
}

fn pick_active_account(accounts: &[Account]) -> String {
    accounts
        .iter()
        .find(|account| account.id != "0" && account.most_recent)
        .or_else(|| accounts.iter().find(|account| account.id != "0" && account.has_grid))
        .or_else(|| accounts.iter().find(|account| account.id != "0" && account.has_shortcuts))
        .or_else(|| accounts.iter().find(|account| account.id != "0"))
        .or_else(|| accounts.first())
        .map(|account| account.id.clone())
        .unwrap_or_default()
}

fn scan_shortcuts(steam_path: &Path, user_id: &str) -> Vec<Game> {
    let shortcuts_path = steam_path
        .join("userdata")
        .join(user_id)
        .join("config")
        .join("shortcuts.vdf");
    let Ok(bytes) = fs::read(shortcuts_path) else {
        return Vec::new();
    };

    parse_shortcuts_vdf(&bytes)
        .into_iter()
        .map(|shortcut| {
            let name = shortcut
                .get("AppName")
                .or_else(|| shortcut.get("appname"))
                .cloned()
                .unwrap_or_else(|| "Non-Steam game".to_string());
            let exe = shortcut
                .get("Exe")
                .or_else(|| shortcut.get("exe"))
                .cloned()
                .unwrap_or_default();
            let app_id = shortcut
                .get("appid")
                .cloned()
                .unwrap_or_else(|| compute_shortcut_app_id(&exe, &name).to_string());
            Game {
                id: format!("nonsteam:{}", app_id),
                app_id: app_id.clone(),
                grid_id: app_id,
                name,
                exe,
                start_dir: shortcut.get("StartDir").cloned().unwrap_or_default(),
                launch_options: shortcut.get("LaunchOptions").cloned().unwrap_or_default(),
                install_dir: String::new(),
                library_path: "Non-Steam".to_string(),
                library_label: "Non-Steam".to_string(),
                game_type: "non-steam".to_string(),
                artwork: Artwork::default(),
            }
        })
        .collect()
}

fn hydrate_artwork(steam_path: &Path, user_id: &str, games: &mut [Game]) {
    for game in games {
        let grid_dir = steam_path
            .join("userdata")
            .join(user_id)
            .join("config")
            .join("grid");
        game.artwork = Artwork {
            grid_vertical: first_existing(vec![
                find_artwork(&grid_dir, &format!("{}p", game.grid_id)),
                find_steam_cache_artwork(steam_path, &game.app_id, "library_600x900"),
            ]),
            grid_horizontal: first_existing(vec![
                find_artwork(&grid_dir, &game.grid_id),
                find_steam_cache_artwork(steam_path, &game.app_id, "library_header"),
            ]),
            hero: first_existing(vec![
                find_artwork(&grid_dir, &format!("{}_hero", game.grid_id)),
                find_steam_cache_artwork(steam_path, &game.app_id, "library_hero"),
            ]),
            logo: first_existing(vec![
                find_artwork(&grid_dir, &format!("{}_logo", game.grid_id)),
                find_steam_cache_artwork(steam_path, &game.app_id, "logo"),
            ]),
            icon: first_existing(vec![
                find_artwork(&grid_dir, &format!("{}_icon", game.grid_id)),
                find_steam_cache_icon(steam_path, &game.app_id),
            ]),
        };
    }
}

fn find_artwork(grid_dir: &Path, stem: &str) -> String {
    for ext in artwork_extensions() {
        let path = grid_dir.join(format!("{}.{}", stem, ext));
        if path.exists() {
            return path.to_string_lossy().to_string();
        }
    }
    String::new()
}

fn find_steam_cache_artwork(steam_path: &Path, app_id: &str, stem: &str) -> String {
    if app_id.is_empty() || !app_id.chars().all(|char| char.is_ascii_digit()) {
        return String::new();
    }

    let cache_dir = steam_path.join("appcache").join("librarycache").join(app_id);
    find_artwork_recursive(&cache_dir, stem).unwrap_or_default()
}

fn find_steam_cache_icon(steam_path: &Path, app_id: &str) -> String {
    if app_id.is_empty() || !app_id.chars().all(|char| char.is_ascii_digit()) {
        return String::new();
    }

    find_cache_icon_recursive(&steam_path.join("appcache").join("librarycache").join(app_id))
        .unwrap_or_default()
}

fn find_artwork_recursive(dir: &Path, stem: &str) -> Option<String> {
    let entries = fs::read_dir(dir).ok()?;
    let mut child_dirs = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            child_dirs.push(path);
            continue;
        }

        let matches_stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(stem));
        let matches_ext = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| artwork_extensions().contains(&value.to_ascii_lowercase().as_str()));

        if matches_stem && matches_ext {
            return Some(path.to_string_lossy().to_string());
        }
    }

    child_dirs
        .iter()
        .find_map(|child| find_artwork_recursive(child, stem))
}

fn find_cache_icon_recursive(dir: &Path) -> Option<String> {
    let entries = fs::read_dir(dir).ok()?;
    let mut child_dirs = Vec::new();
    let mut fallback = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            child_dirs.push(path);
            continue;
        }

        let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        if !artwork_extensions().contains(&ext.to_ascii_lowercase().as_str()) {
            continue;
        }

        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if stem == "icon" || stem.ends_with("_icon") {
            return Some(path.to_string_lossy().to_string());
        }
        if !stem.starts_with("library_") && stem != "logo" && fallback.is_none() {
            fallback = Some(path.to_string_lossy().to_string());
        }
    }

    fallback.or_else(|| child_dirs.iter().find_map(|child| find_cache_icon_recursive(child)))
}

fn first_existing(paths: Vec<String>) -> String {
    paths.into_iter().find(|path| !path.is_empty()).unwrap_or_default()
}

fn parse_key_value_vdf(text: &str) -> serde_json::Map<String, Value> {
    let tokens = tokenize_vdf(text);
    let mut index = 0;
    parse_vdf_object(&tokens, &mut index)
}

fn tokenize_vdf(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(char) = chars.next() {
        match char {
            '"' => {
                let mut token = String::new();
                while let Some(next) = chars.next() {
                    if next == '"' {
                        break;
                    }
                    token.push(next);
                }
                tokens.push(token);
            }
            '{' | '}' => tokens.push(char.to_string()),
            _ => {}
        }
    }
    tokens
}

fn parse_vdf_object(tokens: &[String], index: &mut usize) -> serde_json::Map<String, Value> {
    let mut object = serde_json::Map::new();
    while *index < tokens.len() {
        let key = tokens[*index].clone();
        *index += 1;
        if key == "}" {
            break;
        }
        if tokens.get(*index).is_some_and(|token| token == "{") {
            *index += 1;
            object.insert(key, Value::Object(parse_vdf_object(tokens, index)));
        } else {
            object.insert(
                key,
                Value::String(tokens.get(*index).cloned().unwrap_or_default()),
            );
            *index += 1;
        }
    }
    object
}

fn parse_shortcuts_vdf(bytes: &[u8]) -> Vec<BTreeMap<String, String>> {
    let mut result = Vec::new();
    let mut offset = 0usize;
    let mut current: Option<BTreeMap<String, String>> = None;

    while offset < bytes.len() {
        let entry_type = bytes[offset];
        offset += 1;
        match entry_type {
            0x00 => {
                let (name, next) = read_c_string(bytes, offset);
                offset = next;
                if name.chars().all(|char| char.is_ascii_digit()) {
                    current = Some(BTreeMap::new());
                }
            }
            0x01 => {
                if let Some(shortcut) = current.as_mut() {
                    let (key, next) = read_c_string(bytes, offset);
                    let (value, value_next) = read_c_string(bytes, next);
                    offset = value_next;
                    shortcut.insert(key, value);
                }
            }
            0x02 => {
                if let Some(shortcut) = current.as_mut() {
                    let (key, next) = read_c_string(bytes, offset);
                    offset = next;
                    if offset + 4 <= bytes.len() {
                        let value = i32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
                        shortcut.insert(key, (value as u32).to_string());
                        offset += 4;
                    }
                }
            }
            0x08 => {
                if let Some(shortcut) = current.take() {
                    if shortcut.contains_key("AppName") || shortcut.contains_key("appname") {
                        result.push(shortcut);
                    }
                }
            }
            0x0b => {
                if let Some(shortcut) = current.take() {
                    if shortcut.contains_key("AppName") || shortcut.contains_key("appname") {
                        result.push(shortcut);
                    }
                }
            }
            _ => break,
        }
    }

    result
}

fn read_c_string(bytes: &[u8], offset: usize) -> (String, usize) {
    let mut end = offset;
    while end < bytes.len() && bytes[end] != 0 {
        end += 1;
    }
    (
        String::from_utf8_lossy(&bytes[offset..end]).to_string(),
        (end + 1).min(bytes.len()),
    )
}

fn compute_shortcut_app_id(exe: &str, app_name: &str) -> u32 {
    crc32(format!("{}{}", exe, app_name).as_bytes()) | 0x80000000
}

fn crc32(input: &[u8]) -> u32 {
    let mut crc = 0xffffffffu32;
    for byte in input {
        crc ^= *byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320 & (!((crc & 1).wrapping_sub(1))));
        }
    }
    crc ^ 0xffffffff
}

fn artwork_filename(grid_id: &str, asset_type: &str, ext: &str) -> String {
    format!("{}{}", artwork_stem(grid_id, asset_type), ext)
}

fn artwork_stem(grid_id: &str, asset_type: &str) -> String {
    match asset_type {
        "gridVertical" => format!("{}p", grid_id),
        "gridHorizontal" => grid_id.to_string(),
        "heroes" => format!("{}_hero", grid_id),
        "logos" => format!("{}_logo", grid_id),
        "icons" => format!("{}_icon", grid_id),
        _ => format!("{}p", grid_id),
    }
}

fn image_ext_from_url(url: &str) -> &str {
    let lower = url.to_lowercase();
    if lower.contains(".jpg") || lower.contains(".jpeg") {
        ".jpg"
    } else if lower.contains(".webp") {
        ".webp"
    } else if lower.contains(".ico") {
        ".ico"
    } else {
        ".png"
    }
}

fn backup_and_remove_existing_artwork(grid_dir: &Path, stem: &str) -> Result<(), String> {
    let mut existing = Vec::new();
    for ext in artwork_extensions() {
        let path = grid_dir.join(format!("{}.{}", stem, ext));
        if path.exists() {
            existing.push(path);
        }
    }
    if existing.is_empty() {
        return Ok(());
    }

    let backup_dir = grid_dir.join("_sgm_backup");
    fs::create_dir_all(&backup_dir).map_err(|err| err.to_string())?;
    let stamp = chrono_like_stamp();
    for path in existing {
        let backup_name = format!(
            "{}_{}",
            stamp,
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("artwork")
        );
        fs::copy(&path, backup_dir.join(backup_name)).map_err(|err| err.to_string())?;
        fs::remove_file(&path).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn artwork_extensions() -> &'static [&'static str] {
    &["png", "jpg", "jpeg", "webp", "ico"]
}

fn chrono_like_stamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "backup".to_string())
}

fn drive_label(path: &Path) -> String {
    let text = path.to_string_lossy();
    if text.len() >= 2 && text.as_bytes()[1] == b':' {
        let tail = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Steam");
        format!("{} {}", &text[..2], tail)
    } else {
        text.to_string()
    }
}
