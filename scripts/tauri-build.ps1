Set-Location "C:\Users\lollo\Documents\PROJECTS\Works\Steam Grid Manager"
$env:NPM_CONFIG_PREFIX = "C:\Program Files\nodejs"
$env:RUSTUP_HOME = "$env:USERPROFILE\.rustup"
$env:CARGO_HOME = "$env:USERPROFILE\.cargo"
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
npx tauri build
