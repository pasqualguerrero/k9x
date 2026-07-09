window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installHealModule = function installHealModule(bot) {
  const configStorageKey = "k9x.heal.config";
  const state = {
    running: false,
    timerId: null,
    lastHpHealAt: 0,
    lastManaHealAt: 0,
    lastHpAttemptAt: 0,
    lastManaAttemptAt: 0,
    pendingHpAttempt: null,
    pendingManaAttempt: null,
  };

  const config = Object.assign(
    {
      tickMs: 50,
      healCooldownMs: 1200,
      healRetryMs: 200,
      healConfirmMs: 250,
      minHp: 250,
      hpHotbarSlot: 1,
      hpSpellWords: "exura",
      hpSpellSid: null,
      minMana: 150,
      manaHotbarSlot: 2,
      manaSpellWords: null,
      manaSpellSid: null,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function readStats() {
    const playerState = bot.getPlayerSnapshot?.();

    return playerState
      ? {
          hp: {
            current: Number(playerState.health ?? 0),
            max: Number(playerState.maxHealth ?? 0),
          },
          mana: {
            current: Number(playerState.mana ?? 0),
            max: Number(playerState.maxMana ?? 0),
          },
        }
      : { hp: null, mana: null };
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

  function hasPendingAttempt() {
    return !!(state.pendingHpAttempt || state.pendingManaAttempt);
  }

  function didHpHealSucceed(stats, attempt) {
    if (!stats?.hp || !attempt) {
      return false;
    }

    return (
      stats.hp.current > attempt.hpBefore ||
      (Number.isFinite(attempt.manaBefore) && Number.isFinite(stats.mana?.current) && stats.mana.current < attempt.manaBefore)
    );
  }

  function didManaHealSucceed(stats, attempt) {
    if (!stats?.mana || !attempt) {
      return false;
    }

    return (
      stats.mana.current > attempt.manaBefore ||
      (Number.isFinite(attempt.hpBefore) && Number.isFinite(stats.hp?.current) && stats.hp.current > attempt.hpBefore)
    );
  }

  function resolvePendingAttempts(stats, now = Date.now()) {
    const hpAttempt = state.pendingHpAttempt;
    if (hpAttempt) {
      if (didHpHealSucceed(stats, hpAttempt)) {
        state.lastHpHealAt = hpAttempt.attemptedAt;
        state.pendingHpAttempt = null;
        bot.log("confirmed hp heal", {
          slot: hpAttempt.slot,
          method: hpAttempt.method || null,
          sid: hpAttempt.sid ?? null,
        });
      } else if (now - hpAttempt.attemptedAt >= Math.max(50, Number(config.healConfirmMs) || 0)) {
        state.pendingHpAttempt = null;
        bot.log("hp heal did not register", { slot: hpAttempt.slot });
      }
    }

    const manaAttempt = state.pendingManaAttempt;
    if (manaAttempt) {
      if (didManaHealSucceed(stats, manaAttempt)) {
        state.lastManaHealAt = manaAttempt.attemptedAt;
        state.pendingManaAttempt = null;
        bot.log("confirmed mana heal", {
          slot: manaAttempt.slot,
          method: manaAttempt.method || null,
          sid: manaAttempt.sid ?? null,
        });
      } else if (now - manaAttempt.attemptedAt >= Math.max(50, Number(config.healConfirmMs) || 0)) {
        state.pendingManaAttempt = null;
        bot.log("mana heal did not register", { slot: manaAttempt.slot });
      }
    }
  }

  function hasHpCastOption() {
    return !!(
      normalizeHotbarSlot(config.hpHotbarSlot) ||
      normalizeSpellWords(config.hpSpellWords) ||
      normalizeSpellSid(config.hpSpellSid) != null
    );
  }

  function hasManaCastOption() {
    return !!(
      normalizeHotbarSlot(config.manaHotbarSlot) ||
      normalizeSpellWords(config.manaSpellWords) ||
      normalizeSpellSid(config.manaSpellSid) != null
    );
  }

  function normalizeSpellWords(words) {
    return String(words || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function normalizeSpellSid(sid) {
    const value = Number(sid);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    return normalized >= 0 ? normalized : null;
  }

  function canUseHpHeal(now = Date.now(), stats = readStats()) {
    const { hp } = stats;
    if (!hp || !hasHpCastOption() || state.pendingHpAttempt) return false;

    return (
      hp.current > 0 &&
      hp.current <= Math.max(0, Number(config.minHp) || 0) &&
      now - state.lastHpHealAt >= config.healCooldownMs &&
      now - state.lastHpAttemptAt >= Math.max(50, Number(config.healRetryMs) || 0)
    );
  }

  function canUseManaHeal(now = Date.now(), stats = readStats()) {
    const { mana } = stats;
    if (!mana || !hasManaCastOption() || state.pendingManaAttempt || state.pendingHpAttempt) return false;

    return (
      mana.current <= Math.max(0, Number(config.minMana) || 0) &&
      now - state.lastManaHealAt >= config.healCooldownMs &&
      now - state.lastManaAttemptAt >= Math.max(50, Number(config.healRetryMs) || 0)
    );
  }

  function triggerHpHeal(now = Date.now(), stats = readStats()) {
    if (!canUseHpHeal(now, stats)) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.hpHotbarSlot);
    const castResult = bot.castSpell({
      sid: config.hpSpellSid,
      words: config.hpSpellWords,
      hotbarSlot: slot,
    });

    if (castResult.ok) {
      state.lastHpAttemptAt = now;
      state.pendingHpAttempt = {
        attemptedAt: now,
        slot,
        method: castResult.method,
        sid: castResult.sid ?? null,
        hpBefore: Number(stats.hp?.current ?? 0),
        manaBefore: Number(stats.mana?.current ?? 0),
      };
      bot.log("cast hp heal", {
        method: castResult.method,
        sid: castResult.sid ?? null,
        slot,
        minHp: config.minHp,
      });
    }

    return castResult.ok;
  }

  function triggerManaHeal(now = Date.now(), stats = readStats()) {
    if (!canUseManaHeal(now, stats)) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.manaHotbarSlot);
    const castResult = bot.castSpell({
      sid: config.manaSpellSid,
      words: config.manaSpellWords,
      hotbarSlot: slot,
      fallbackChat: !!normalizeSpellWords(config.manaSpellWords),
    });

    if (castResult.ok) {
      state.lastManaAttemptAt = now;
      state.pendingManaAttempt = {
        attemptedAt: now,
        slot,
        method: castResult.method,
        sid: castResult.sid ?? null,
        hpBefore: Number(stats.hp?.current ?? 0),
        manaBefore: Number(stats.mana?.current ?? 0),
      };
      bot.log("cast mana heal", {
        method: castResult.method,
        sid: castResult.sid ?? null,
        slot,
        minMana: config.minMana,
      });
    }

    return castResult.ok;
  }

  function tryHeal() {
    if (!config.enabled) {
      return false;
    }

    const now = Date.now();
    const stats = readStats();

    resolvePendingAttempts(stats, now);

    if (hasPendingAttempt()) {
      return false;
    }

    if (triggerHpHeal(now, stats)) {
      return true;
    }

    return triggerManaHeal(now, stats);
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function tick() {
    if (!state.running) return;

    try {
      tryHeal();
    } catch (error) {
      bot.log("auto heal tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    persistConfig();

    if (state.running) {
      bot.log("auto heal already running");
      return false;
    }

    state.running = true;
    bot.log("auto heal started", { ...config });
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
    bot.log("auto heal stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      stats: readStats(),
      lastHpHealAt: state.lastHpHealAt,
      lastManaHealAt: state.lastManaHealAt,
      lastHpAttemptAt: state.lastHpAttemptAt,
      lastManaAttemptAt: state.lastManaAttemptAt,
      pendingHpAttempt: state.pendingHpAttempt ? { ...state.pendingHpAttempt } : null,
      pendingManaAttempt: state.pendingManaAttempt ? { ...state.pendingManaAttempt } : null,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "hpHotbarSlot")) {
      nextConfig.hpHotbarSlot = normalizeHotbarSlot(nextConfig.hpHotbarSlot) ?? config.hpHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "manaHotbarSlot")) {
      nextConfig.manaHotbarSlot = normalizeHotbarSlot(nextConfig.manaHotbarSlot) ?? config.manaHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "minHp")) {
      nextConfig.minHp = Math.max(0, Number(nextConfig.minHp) || 0);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "minMana")) {
      nextConfig.minMana = Math.max(0, Number(nextConfig.minMana) || 0);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "healRetryMs")) {
      nextConfig.healRetryMs = Math.max(50, Number(nextConfig.healRetryMs) || 50);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "healConfirmMs")) {
      nextConfig.healConfirmMs = Math.max(50, Number(nextConfig.healConfirmMs) || 50);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "hpSpellSid")) {
      nextConfig.hpSpellSid = normalizeSpellSid(nextConfig.hpSpellSid);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "manaSpellSid")) {
      nextConfig.manaSpellSid = normalizeSpellSid(nextConfig.manaSpellSid);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "hpSpellWords")) {
      const words = normalizeSpellWords(nextConfig.hpSpellWords);
      nextConfig.hpSpellWords = words || null;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "manaSpellWords")) {
      const words = normalizeSpellWords(nextConfig.manaSpellWords);
      nextConfig.manaSpellWords = words || null;
    }

    Object.assign(config, nextConfig);
    persistConfig();
    bot.log("auto heal config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.heal = {
    start,
    stop,
    status,
    updateConfig,
    readStats,
    tryHeal,
    canUseHpHeal,
    canUseManaHeal,
    triggerHpHeal,
    triggerManaHeal,
    normalizeHotbarSlot,
    config,
  };
};
