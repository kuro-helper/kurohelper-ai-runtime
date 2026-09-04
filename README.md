# KuroHelper AI Runtime

## Build

Requires Docker Desktop with Docker Compose and Node.js 22 or later. Use the
following directory layout so the Compose character-card paths and shared
runtime-secret script work without overrides:

```text
workspace/
├── KuroHelper/
│   ├── kurohelper-ai-runtime/
│   └── kurohelper/
└── kuro/
    └── kuro-character/
```

From `workspace`, clone the required repositories:

```powershell
New-Item -ItemType Directory -Force ./KuroHelper, ./kuro
git clone https://github.com/kuro-helper/kurohelper-ai-runtime.git ./KuroHelper/kurohelper-ai-runtime
git clone https://github.com/kuro-helper/kurohelper.git ./KuroHelper/kurohelper
git clone https://github.com/tommy-125/kuro-character.git ./kuro/kuro-character

Set-Location ./KuroHelper/kurohelper-ai-runtime
Copy-Item .env.example .env
Copy-Item server/config.example.js server/config.js
Copy-Item ../kurohelper/.env.example ../kurohelper/.env
```

All user-facing AI Runtime settings are centralized in `.env`; `server/config.js`
only loads and validates those values. Set `CHAT_API_KEY`, `MEMORY_API_KEY`, and
`VISION_API_KEY` independently, configure the character-card paths, then
generate and synchronize the shared runtime secret:

```powershell
npm run configure-runtime-secret
```

Build and start the containers:

```powershell
docker compose up -d --build
docker compose ps
```
