window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoMagicShieldModule = function installAutoMagicShieldModule(bot) {
  const configStorageKey = "minibiaBot.magicShield.config";
  const MAGIC_SHIELD_FALLBACK_DURATION_MS = 180000;
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
    assumedActiveUntil: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 500,
      spellWords: "utamo vita",
      recastCooldownMs: 2000,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 500;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getMagicShieldConditionId() {
    const conditionManagerPrototype = window.ConditionManager?.prototype;
    const playerConditions = window.gameClient?.player?.conditions;
    const candidateKeys = [
      "MAGIC_SHIELD",
      "MANA_SHIELD",
      "MAGICSHIELD",
      "MANASHIELD",
      "UTAMO_VITA",
    ];

    for (const key of candidateKeys) {
      const value = conditionManagerPrototype?.[key] ?? playerConditions?.[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  function isMagicShieldActive(now = Date.now()) {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;
    const magicShieldConditionId = getMagicShieldConditionId();

    if (magicShieldConditionId != null) {
      if (conditions?.has) {
        return conditions.has(magicShieldConditionId);
      }

      if (player?.hasCondition) {
        return player.hasCondition(magicShieldConditionId);
      }
    }

    return now < state.assumedActiveUntil;
  }

  function getGateStatus(now = Date.now()) {
    const cooldownRemainingMs = Math.max(0, config.recastCooldownMs - (now - state.lastCastAt));
    const cooldownReady = cooldownRemainingMs === 0;
    const magicShieldActive = isMagicShieldActive(now);

    return {
      magicShieldActive,
      cooldownReady,
      cooldownRemainingMs,
      canCast: !magicShieldActive && cooldownReady,
    };
  }

  function canCastMagicShield(now = Date.now()) {
    return getGateStatus(now).canCast;
  }

  function tryCastMagicShield(now = Date.now()) {
    if (!config.enabled || !canCastMagicShield(now)) {
      return false;
    }

    const sent = bot.sendChat(config.spellWords);
    if (sent) {
      state.lastCastAt = now;
      state.assumedActiveUntil = now + MAGIC_SHIELD_FALLBACK_DURATION_MS;
      bot.log("cast magic shield spell", { spellWords: config.spellWords });
    }

    return sent;
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function runImmediateTick() {
    if (!state.running) return;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    tick();
  }

  function handleResume() {
    if (document.hidden) {
      return;
    }

    runImmediateTick();
  }

  function attachResumeListeners() {
    if (resumeListenersAttached) {
      return;
    }

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);
    resumeListenersAttached = true;
  }

  function detachResumeListeners() {
    if (!resumeListenersAttached) {
      return;
    }

    document.removeEventListener("visibilitychange", handleResume);
    window.removeEventListener("focus", handleResume);
    window.removeEventListener("pageshow", handleResume);
    resumeListenersAttached = false;
  }

  function tick() {
    if (!state.running) return;

    try {
      tryCastMagicShield();
    } catch (error) {
      bot.log("auto magic shield tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 500;
    persistConfig();

    if (state.running) {
      bot.log("auto magic shield already running");
      return false;
    }

    state.running = true;
    attachResumeListeners();
    bot.log("auto magic shield started", { ...config });
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

    detachResumeListeners();

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    bot.log("auto magic shield stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      gates: getGateStatus(),
      lastCastAt: state.lastCastAt,
      assumedActiveUntil: state.assumedActiveUntil,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim() || config.spellWords;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "recastCooldownMs")) {
      nextConfig.recastCooldownMs = Math.max(0, Number(nextConfig.recastCooldownMs) || 0);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 500;
    persistConfig();
    bot.log("auto magic shield config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.magicShield = {
    start,
    stop,
    status,
    updateConfig,
    isMagicShieldActive,
    canCastMagicShield,
    tryCastMagicShield,
    config,
  };
};
