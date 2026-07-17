window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installForceLightModule = function installForceLightModule(bot) {
  const configStorageKey = "k9x.forceLight.config";
  const LIGHT_CONDITION_ID = 7;
  // Client comments: utevo lux = 9, gran lux = 12, vis lux = 14
  const PRESET_LEVELS = {
    lux: 9,
    gran: 12,
    vis: 14,
  };

  const state = {
    running: false,
    timerId: null,
  };

  const storedConfig = bot.storage.get(configStorageKey, {}) || {};
  const config = Object.assign(
    {
      tickMs: 500,
      // Default to utevo gran lux strength.
      lightLevel: PRESET_LEVELS.gran,
      enabled: false,
    },
    storedConfig
  );
  config.lightLevel = normalizeLightLevel(config.lightLevel);
  config.tickMs = Math.max(100, Math.trunc(Number(config.tickMs) || 500));
  config.enabled = !!config.enabled;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeLightLevel(value) {
    const next = Math.trunc(Number(value));
    if (!Number.isFinite(next)) {
      return PRESET_LEVELS.gran;
    }

    // Keep within a sensible bubble size range (client uses max(3, level)).
    return Math.min(20, Math.max(3, next));
  }

  function getLightConditionId() {
    return window.ConditionManager?.prototype?.LIGHT ?? LIGHT_CONDITION_ID;
  }

  function getPlayer() {
    return window.gameClient?.player || null;
  }

  function hasLightCondition(player = getPlayer()) {
    if (!player) {
      return false;
    }

    const lightId = getLightConditionId();
    if (typeof player.hasCondition === "function") {
      return !!player.hasCondition(lightId);
    }

    if (player.conditions?.has) {
      return player.conditions.has(lightId);
    }

    return false;
  }

  function applyForceLight() {
    const player = getPlayer();
    if (!player) {
      return false;
    }

    const lightId = getLightConditionId();
    const level = normalizeLightLevel(config.lightLevel);

    // Match client spell/equipment path used by the renderer.
    player.__lightLevel = level;
    // Permanent so temporary-condition UI / clear paths treat it like gear light.
    player.__lightPermanent = true;

    if (!hasLightCondition(player) && typeof player.addCondition === "function") {
      player.addCondition(lightId);
    }

    return true;
  }

  function clearForceLight() {
    const player = getPlayer();
    if (!player) {
      return false;
    }

    const lightId = getLightConditionId();
    player.__lightPermanent = false;
    player.__lightLevel = 0;

    if (hasLightCondition(player) && typeof player.removeCondition === "function") {
      // Client may refuse remove when permanent was still set; we cleared it above.
      try {
        player.removeCondition(lightId);
      } catch (error) {
        bot.log("force light clear failed", error?.message || error);
      }
    }

    return true;
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
      if (config.enabled) {
        applyForceLight();
      }
    } catch (error) {
      bot.log("force light tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.lightLevel = normalizeLightLevel(config.lightLevel);
    persistConfig();

    if (state.running) {
      applyForceLight();
      bot.log("force light already running", { lightLevel: config.lightLevel });
      return false;
    }

    state.running = true;
    applyForceLight();
    bot.log("force light started", { lightLevel: config.lightLevel });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    const shouldClear = options.clear !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    if (shouldClear) {
      clearForceLight();
    }

    bot.log("force light stopped");
    return true;
  }

  function status() {
    const player = getPlayer();
    return {
      running: state.running,
      config: { ...config },
      playerLightLevel: player?.__lightLevel ?? null,
      playerLightPermanent: !!player?.__lightPermanent,
      hasLightCondition: hasLightCondition(player),
      presets: { ...PRESET_LEVELS },
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "lightLevel")) {
      nextConfig.lightLevel = normalizeLightLevel(nextConfig.lightLevel);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "tickMs")) {
      const tickMs = Math.trunc(Number(nextConfig.tickMs));
      nextConfig.tickMs = Number.isFinite(tickMs) ? Math.max(100, tickMs) : config.tickMs;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "enabled")) {
      nextConfig.enabled = !!nextConfig.enabled;
    }

    Object.assign(config, nextConfig);
    persistConfig();

    if (config.enabled) {
      start();
    } else if (state.running) {
      stop();
    } else {
      bot.log("force light config updated", { ...config });
    }

    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.addCleanup(() => {
    stop({ persistEnabled: false, clear: true });
  });

  bot.forceLight = {
    start,
    stop,
    status,
    updateConfig,
    applyForceLight,
    clearForceLight,
    config,
    presets: PRESET_LEVELS,
  };
};
