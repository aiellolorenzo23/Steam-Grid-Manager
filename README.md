<p align="center">
  <img src="public/steamgriddb-logo.svg" alt="Steam Grid Manager" width="140">
</p>

# Steam Grid Manager

Steam Grid Manager is a desktop app for managing Steam library artwork using SteamGridDB.

It can scan local Steam libraries, show installed games, non-installed games from your Steam library, and games added as "Non-Steam", search for artwork on SteamGridDB, and apply covers, heroes, logos, and icons directly to the Steam profile artwork folder.

## Features

- Automatically detects the active Steam account from `loginusers.vdf`.
- Reads all Steam libraries configured in `libraryfolders.vdf`.
- Shows installed games, non-installed games, and Non-Steam games.
- Displays previews already present in `userdata/<steamUserId>/config/grid` and in the official Steam cache.
- Searches for artwork on SteamGridDB using an API key.
- Applies covers, heroes, logos, and icons with automatic backup before overwriting files.
- Saves the Steam path, SteamGridDB API key, and Steam Web API key in local settings.

## Launch

Prebuilt desktop app:

```powershell
& ".\src-tauri\target\release\steam-grid-manager.exe"
```

Tauri development mode:

```powershell
.\scripts\tauri-dev.ps1
```

Rebuild the `.exe` and installer:

```powershell
.\scripts\tauri-build.ps1
```

Local web mode:

```powershell
node src/server.mjs
```

Then open:

```text
http://localhost:5177
```

## API Key

You need a SteamGridDB API key to search for artwork.

You need a Steam Web API key to also view non-installed games:

```text
https://steamcommunity.com/dev/apikey
```

For the domain field, you can use:

```text
localhost
```

## Steam Path

Default path:

```text
C:\Program Files (x86)\Steam
```

You can change it from the top bar of the app.

## Note

Steam does not provide an official API to modify local artwork. The app works directly with the files used by the Steam client, specifically:

```text
userdata/<steamUserId>/config/grid
appcache/librarycache
```
