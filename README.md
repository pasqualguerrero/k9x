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
fetch("https://raw.githubusercontent.com/pasqualguerrero/k9x/refs/heads/main/pz-bot.js")
  .then((r) => r.text())
  .then((code) => eval(code));
```

If the console warns about pasting code, type `allow pasting` first and press `Enter`, then paste the script loader again.
