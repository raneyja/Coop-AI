# Coop UI demos

Standalone HTML prototypes for extension webview interactions. Open in a browser — no build step.

## Launch typewriter

**Path:** [`launch-typewriter/index.html`](./launch-typewriter/index.html)

Blinking cursor → types `ask coop` letter-by-letter with per-character flash → fades into the real composer and quick actions.

### Controls

| Button | Action |
|--------|--------|
| **Replay** | Restart the sequence |
| **Abbreviated** | Toggle fast return-visit timing (~600ms typing) |
| **Light theme** | Toggle dark/light Coop panel tokens |

### Open locally

```bash
open demo/launch-typewriter/index.html
```

Or serve from repo root:

```bash
npx --yes serve demo/launch-typewriter -p 5199
# → http://localhost:5199
```
