window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoFishingModule = function installAutoFishingModule(bot) {
  const configStorageKey = "k9x.fishing.config";
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
    mouseX: null,
    mouseY: null,
    listeningForRightClick: false,
  };

  const config = Object.assign(
    {
      tickMs: 200,
      rodHotbarSlot: null,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  const storedTickMs = Number(config.tickMs);
  config.tickMs = !Number.isFinite(storedTickMs) || storedTickMs >= 1000
    ? 200
    : Math.max(50, storedTickMs);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeHotbarSlot(slot) {
    const value = Number(slot);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    if (normalized < 1 || normalized > 12) {
      return null;
    }

    return normalized;
  }

  function readRodHotbarSlotFromPrompt(defaultSlot = null) {
    const fallback = normalizeHotbarSlot(defaultSlot) || 1;
    const input = window.prompt("Fishing rod hotkey slot (1-12)", String(fallback));

    if (input == null) {
      return null;
    }

    const slot = normalizeHotbarSlot(input);
    if (!slot) {
      window.alert("Invalid slot. Use a number from 1 to 12.");
      return null;
    }

    return slot;
  }

  function trackMousePosition(event) {
    state.mouseX = Number(event?.clientX);
    state.mouseY = Number(event?.clientY);
  }

  function dispatchLeftClickAtPointer() {
    if (!Number.isFinite(state.mouseX) || !Number.isFinite(state.mouseY)) {
      return false;
    }

    const target = document.elementFromPoint(state.mouseX, state.mouseY);
    if (!target) {
      return false;
    }

    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: state.mouseX,
      clientY: state.mouseY,
      button: 0,
      buttons: 1,
    };

    target.dispatchEvent(new MouseEvent("mousedown", eventInit));
    target.dispatchEvent(new MouseEvent("mouseup", eventInit));
    target.dispatchEvent(new MouseEvent("click", eventInit));
    return true;
  }

  function handleRightClickToStop(event) {
    if (!state.running) {
      return;
    }

    if (event?.button === 2 || event?.type === "contextmenu") {
      stop();
    }
  }

  function ensureRightClickStopListener() {
    if (state.listeningForRightClick) {
      return;
    }

    window.addEventListener("mousedown", handleRightClickToStop, true);
    window.addEventListener("contextmenu", handleRightClickToStop, true);
    state.listeningForRightClick = true;
  }

  function tryFish() {
    if (!config.enabled) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.rodHotbarSlot);
    if (!slot) {
      return false;
    }

    // Rod hotbar + map click emit THING_USE_WITH, which input-metrics
    // samples as a human intent. Same opt-out as cave use-with / hotbar.
    return bot.withAutomationSendSkip(() => {
      const hotbarClicked = bot.clickHotbar(slot - 1);
      const waterClicked = dispatchLeftClickAtPointer();

      if (hotbarClicked && waterClicked) {
        state.lastCastAt = Date.now();
        return true;
      }

      return false;
    }) === true;
  }

  function scheduleNextTick() {
    if (!state.running) {
      return;
    }

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function tick() {
    if (!state.running) {
      return;
    }

    try {
      tryFish();
    } catch (error) {
      bot.log("auto fishing tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    const promptHotbarSlot = overrides.promptHotbarSlot !== false;
    let nextRodHotbarSlot = normalizeHotbarSlot(overrides.rodHotbarSlot);

    if (!nextRodHotbarSlot) {
      const fallbackSlot = normalizeHotbarSlot(config.rodHotbarSlot);
      if (promptHotbarSlot) {
        nextRodHotbarSlot = readRodHotbarSlotFromPrompt(fallbackSlot);
        if (!nextRodHotbarSlot) {
          return false;
        }
      } else {
        nextRodHotbarSlot = fallbackSlot;
      }
    }

    if (!nextRodHotbarSlot) {
      bot.log("auto fishing missing rod hotbar slot");
      return false;
    }

    Object.assign(config, overrides, {
      enabled: true,
      rodHotbarSlot: nextRodHotbarSlot,
      tickMs: Math.max(50, Number(overrides.tickMs) || config.tickMs || 200),
    });
    persistConfig();

    if (bot.cave?.status?.().running) {
      bot.cave.stop();
    }

    if (state.running) {
      bot.ui?.refreshAutoFishingStatus?.();
      return false;
    }

    state.running = true;
    ensureRightClickStopListener();
    bot.log("auto fishing started", { rodHotbarSlot: config.rodHotbarSlot });
    bot.ui?.refreshAutoFishingStatus?.();
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    bot.log("auto fishing stopped");
    bot.ui?.refreshAutoFishingStatus?.();
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      lastCastAt: state.lastCastAt,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "rodHotbarSlot")) {
      nextConfig.rodHotbarSlot = normalizeHotbarSlot(nextConfig.rodHotbarSlot) ?? config.rodHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "tickMs")) {
      nextConfig.tickMs = Math.max(50, Number(nextConfig.tickMs) || config.tickMs || 200);
    }

    Object.assign(config, nextConfig);
    config.tickMs = Math.max(50, Number(config.tickMs) || 200);
    persistConfig();
    bot.log("auto fishing config updated", { ...config });
    return { ...config };
  }

  window.addEventListener("mousemove", trackMousePosition, { passive: true });
  bot.addCleanup(() => {
    window.removeEventListener("mousemove", trackMousePosition, { passive: true });
    window.removeEventListener("mousedown", handleRightClickToStop, true);
    window.removeEventListener("contextmenu", handleRightClickToStop, true);
  });

  if (config.enabled) {
    start({ promptHotbarSlot: false });
  }

  bot.fishing = {
    start,
    stop,
    status,
    updateConfig,
    tryFish,
    normalizeHotbarSlot,
    config,
  };

  bot.startAutoFishing = start;
  bot.stopAutoFishing = stop;
};
