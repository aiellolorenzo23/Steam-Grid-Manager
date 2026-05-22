<p align="center">
  <img src="public/steamgriddb-logo.svg" alt="Steam Grid Manager" width="140">
</p>

# Steam Grid Manager

Steam Grid Manager e' una app desktop per gestire le immagini della libreria Steam usando SteamGridDB.

Permette di scansionare le librerie Steam locali, vedere giochi installati, giochi non installati della propria libreria Steam e giochi aggiunti come "Non-Steam", cercare artwork su SteamGridDB e applicare cover, hero, logo e icone direttamente nella cartella artwork del profilo Steam.

## Funzioni

- Rileva automaticamente l'account Steam attivo da `loginusers.vdf`.
- Legge tutte le librerie Steam configurate in `libraryfolders.vdf`.
- Mostra giochi installati, giochi non installati e giochi Non-Steam.
- Mostra le anteprime gia' presenti da `userdata/<steamUserId>/config/grid` e dalla cache ufficiale Steam.
- Cerca artwork su SteamGridDB tramite API key.
- Applica cover, hero, logo e icone con backup automatico prima della sovrascrittura.
- Salva path Steam, SteamGridDB API key e Steam Web API key nelle impostazioni locali.

## Avvio

App desktop gia' compilata:

```powershell
& ".\src-tauri\target\release\steam-grid-manager.exe"
```

Modalita sviluppo Tauri:

```powershell
.\scripts\tauri-dev.ps1
```

Rigenerare exe e installer:

```powershell
.\scripts\tauri-build.ps1
```

Modalita web locale:

```powershell
node src/server.mjs
```

Poi apri:

```text
http://localhost:5177
```

## API Key

Per cercare artwork serve una SteamGridDB API key.

Per vedere anche i giochi non installati serve una Steam Web API key:

```text
https://steamcommunity.com/dev/apikey
```

Nel campo dominio puoi usare:

```text
localhost
```

## Path Steam

Path predefinito:

```text
C:\Program Files (x86)\Steam
```

Puoi cambiarlo dalla barra superiore dell'app.

## Nota

Steam non espone una API ufficiale per modificare gli artwork locali. L'app lavora sui file usati dal client Steam, in particolare:

```text
userdata/<steamUserId>/config/grid
appcache/librarycache
```
