# NutriLog

A voice-powered diet tracker PWA for iPhone, built with vanilla HTML/JS and Claude AI. Speak about what you've eaten, and Claude parses it into a structured nutrition table — calories, protein, carbs, fat, and fiber — stored in your browser and viewable as a clean diary.

Comes with an MCP server so you can chat with Claude Desktop directly about your diet.

---

## Features

- **Voice logging** — tap the mic, describe your meal in natural language, and Claude fills in the nutrition facts
- **Text fallback** — type instead if voice isn't available (or you're somewhere quiet)
- **Nutrition tables** — every entry is broken down per food item with estimated macros
- **Diary view** — full history grouped by date with daily calorie and macro totals
- **AI diet coach** — chat tab lets you ask Claude questions about your eating habits using your actual diary as context
- **Markdown export** — download your entire diary as a `.md` file
- **MCP server** — query your diary from Claude Desktop with natural language
- **Offline-capable** — service worker caches the app so it works without a connection
- **BYOK** — bring your own Anthropic API key, stored locally in your browser only

---

## Screenshots

| Log | Diary | Chat | Settings |
|-----|-------|------|----------|
| Voice button + today's meals | Date-grouped history with macro totals | AI diet coach | API key + export |

---

## Getting Started

### 1. Run locally

```bash
git clone https://github.com/crocsarecool/nutrition-app.git
cd nutrition-app
python3 -m http.server 3457
```

Open [http://localhost:3457](http://localhost:3457) in your browser.

### 2. Add your API key

Go to the **Settings** tab and enter your [Anthropic API key](https://console.anthropic.com/). It's stored only in your browser's `localStorage` — never sent anywhere except Anthropic's API.

### 3. Log your first meal

Tap the green mic button and say something like:

> *"Had two scrambled eggs with a slice of toast and a black coffee this morning"*

Claude will respond with a nutrition table:

| Item | Qty | Cal | Protein | Carbs | Fat | Fiber | Notes |
|------|-----|-----|---------|-------|-----|-------|-------|
| Scrambled eggs | 2 large | 182 | 12g | 2g | 14g | 0g | Cooked with ~1 tsp butter assumed |
| Whole wheat toast | 1 slice | 80 | 3g | 15g | 1g | 2g | Medium slice assumed |
| Black coffee | 250ml | 2 | 0g | 0g | 0g | 0g | No milk or sugar |

---

## Installing on iPhone

The app is a full PWA — it installs to your home screen and runs like a native app.

1. Deploy to any HTTPS host (see [Deployment](#deployment) below)
2. Open the URL in **Safari** on your iPhone
3. Tap the **Share** button → **Add to Home Screen**
4. Tap **Add**

> Voice input requires microphone permission. If Safari prompts you, tap **Allow**. If voice is unavailable in standalone mode, a text input field appears automatically as a fallback.

---

## Deployment

The app is a static site — no server required. Deploy the repo root to any free static host:

### GitHub Pages

1. Go to your repo → **Settings** → **Pages**
2. Set source to **Deploy from a branch** → `main` → `/ (root)`
3. Your app will be live at `https://crocsarecool.github.io/nutrition-app`

### Netlify

Drag and drop the repo folder at [netlify.com/drop](https://netlify.com/drop). Done.

### Vercel

```bash
npm i -g vercel
vercel
```

---

## MCP Server

The MCP server lets Claude Desktop read and reason about your exported diary.

### Setup

```bash
cd mcp-server
npm install
```

Add the following to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nutrilog": {
      "command": "node",
      "args": ["/path/to/nutrition-app/mcp-server/diet-mcp.js"],
      "env": {
        "NUTRILOG_DIARY_PATH": "/Users/your-name/Downloads/nutrilog-diary.md"
      }
    }
  }
}
```

### Exporting your diary

In the app, go to **Settings** → **Download nutrilog-diary.md**, then move the file to the path you set in `NUTRILOG_DIARY_PATH`.

### Available tools

| Tool | Description |
|------|-------------|
| `get_diary_entries` | Returns logged food items, optionally filtered by date |
| `get_nutritional_summary` | Daily calorie and macro totals across a date range |
| `search_entries` | Full-text search across all food items and meal titles |

Once configured, you can ask Claude Desktop things like:

- *"How many calories did I eat this week?"*
- *"What's my average daily protein intake?"*
- *"When did I last eat something with fibre?"*
- *"Am I hitting my fat targets?"*

---

## How it works

```
Voice / Text
     │
     ▼
SpeechRecognition API (iOS Safari)
     │
     ▼
Claude API (claude-sonnet-4-6)
  └─ System prompt: parse food description → structured markdown table
     │
     ▼
localStorage  ──────────────────────────────────────────►  Export .md
     │                                                          │
     ▼                                                          ▼
Rendered table in app                                   MCP server reads file
                                                               │
                                                               ▼
                                                      Claude Desktop tools
```

**No backend. No database. No sign-up.** Your data lives in your browser.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML, CSS, JavaScript (no framework, no build step) |
| AI | [Anthropic Claude API](https://docs.anthropic.com) (`claude-sonnet-4-6`) |
| Voice | Web Speech API (`SpeechRecognition`) |
| Storage | `localStorage` |
| Offline | Service Worker (cache-first) |
| MCP | [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) (Node.js, stdio transport) |
| Icons | Generated PNG (no external assets) |

---

## File structure

```
nutrition-app/
├── index.html          # App shell, all CSS, all tabs
├── app.js              # Storage, VoiceInput, ClaudeAPI, Renderer, App
├── manifest.json       # PWA manifest
├── service-worker.js   # Offline caching
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── mcp-server/
    ├── diet-mcp.js     # MCP server (3 tools)
    └── package.json
```

---

## Privacy

- Your API key is stored in `localStorage` in your browser only
- Food entries are stored in `localStorage` — they never leave your device unless you export them
- API calls go directly from your browser to `api.anthropic.com` — no proxy, no middleman
- The MCP server reads a local file on your own machine

---

## License

MIT
