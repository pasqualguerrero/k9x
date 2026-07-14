# Minibia Bot (v)

## Load From GitHub In Chrome Or Edge

1. Open the game page.
2. Click the browser menu button in the top-right:
   Chrome: the three vertical dots.
   Edge: the three horizontal dots.
3. Go to `More tools`.
4. Click `Developer tools`.
5. Click the `Console` tab.
6. Paste this and press `Enter`:

```js
fetch("https://raw.githubusercontent.com/pasqualguerrero/minibia-bot/refs/heads/main/pz-bot.js")
  .then((r) => r.text())
  .then((code) => eval(code));
```

If the console warns about pasting code, type `allow pasting` first and press `Enter`, then paste the script loader again.

## Code

This repo now has a simple source layout for browser-loaded Minibia routines, while still serving a single `pz-bot.js` bundle that you can reload from DevTools.

**Layout**

- [pz-bot.js](/home/yuno/minibia-bot/pz-bot.js): built browser bundle you load in game
- [src/core.js](/home/yuno/minibia-bot/src/core.js): shared runtime helpers
- [src/modules/pz.js](/home/yuno/minibia-bot/src/modules/pz.js): PZ/home navigation module
- [src/modules/rune.js](/home/yuno/minibia-bot/src/modules/rune.js): rune loop module
- [src/modules/heal.js](/home/yuno/minibia-bot/src/modules/heal.js): auto heal loop for hp and mana hotkeys
- [src/ui/panel.js](/home/yuno/minibia-bot/src/ui/panel.js): draggable in-game panel
- [src/main.js](/home/yuno/minibia-bot/src/main.js): bundle entrypoint
- [build.sh](/home/yuno/minibia-bot/build.sh): rebuilds `pz-bot.js` from `src/`
- [cors_http_server.py](/home/yuno/minibia-bot/cors_http_server.py): local dev server with CORS headers for browser fetches

**Reload In Game**

```js
fetch("http://127.0.0.1:9009/pz-bot.js")
  .then((r) => r.text())
  .then((code) => eval(code));
```

If the browser blocks that request because of CORS, run:

```bash
python3 cors_http_server.py
```

That serves this folder on `http://127.0.0.1:9009/` with `Access-Control-Allow-Origin: *`.

**Main API**

```js
minibiaBot.status()

minibiaBot.pz.setHomePzCurrentSpot()
minibiaBot.pz.goToHomePz()
minibiaBot.pz.goToNearestPz()

minibiaBot.rune.start()
minibiaBot.rune.stop()
minibiaBot.rune.status()

minibiaBot.heal.start()
minibiaBot.heal.stop()
minibiaBot.heal.status()

```

Backward-compatible alias:

```js
pzBot.goToNearestPz()
```

**Rebuild After Editing `src/`**

```bash
./build.sh
```

**Notes**

- The panel is draggable and saves its position in `localStorage`.
- Reloading the bundle destroys the existing panel and stops the existing loops before installing the new one.
- The served runtime is `pz-bot.js`; source lives under `src/`.


## Download minibia source
```
 (async () => {
    const fromPerf = performance.getEntriesByType("resource").map(r => r.name);
    const fromScripts = [...document.scripts].map(s => s.src).filter(Boolean);

    const urls = [...new Set([...fromPerf, ...fromScripts])]
      .filter(url => url.includes("minibia") && /\.js(\?|$)/i.test(url))
      .sort();

    console.log(`Found ${urls.length} JS files`);

    const parts = [];

    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();

        parts.push(
          `\n\n/* ===== FILE: ${url} ===== */\n\n${text}`
        );

        console.log(`Fetched: ${url}`);
      } catch (err) {
        parts.push(
          `\n\n/* ===== FAILED: ${url} =====\n${String(err)}\n===== */\n\n`
        );
        console.error(`Failed: ${url}`, err);
      }
    }

    const blob = new Blob(parts, { type: "text/javascript;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = blobUrl;
    a.download = "minibia-all.js";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    console.log("Downloaded minibia-all.js");
  })();
```
