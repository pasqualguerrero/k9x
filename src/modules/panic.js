window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installPanicModule = function installPanicModule(bot) {
  const configStorageKey = "minibiaBot.panic.config";
  const state = {
    running: false,
    timerId: null,
    lastHealth: null,
    lastTriggerAt: 0,
    lastDamageEventKey: null,
  };

  const config = Object.assign(
    {
      tickMs: 200,
      triggerCooldownMs: 4000,
      unknownPlayerEnabled: false,
      healthLossEnabled: false,
      trustedNames: [],
      gameMasterNames: [],
    },
    bot.storage.get(configStorageKey, {})
  );

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function getTrustedNames() {
    return Array.from(
      new Set(
        (config.trustedNames || [])
          .map((name) => normalizeName(name))
          .filter(Boolean)
      )
    );
  }

  function getGameMasterNames() {
    return Array.from(
      new Set(
        (config.gameMasterNames || [])
          .map((name) => normalizeName(name))
          .filter(Boolean)
      )
    );
  }

  function getVisiblePlayers() {
    const me = bot.getPlayerPosition();
    const players = bot.xray?.getVisiblePlayers?.() || [];
    if (!me) {
      return players;
    }

    return players.filter((creature) => {
      const z = Number(creature?.__position?.z);
      return Number.isFinite(z) && Math.abs(z - me.z) <= 1;
    });
  }

  function getUnknownVisiblePlayers() {
    const trusted = new Set(getTrustedNames());

    return getVisiblePlayers().filter((creature) => {
      const name = normalizeName(creature?.name);
      return !!name && !trusted.has(name);
    });
  }

  function getTrustedVisiblePlayers() {
    const trusted = new Set(getTrustedNames());

    return getVisiblePlayers().filter((creature) => {
      const name = normalizeName(creature?.name);
      return !!name && trusted.has(name);
    });
  }

  function getVisibleGameMasters() {
    const gameMasters = new Set(getGameMasterNames());

    return getVisiblePlayers().filter((creature) => {
      const name = normalizeName(creature?.name);
      return !!name && gameMasters.has(name);
    });
  }

  function getRecentChannelMessages() {
    return (window.gameClient?.interface?.channelManager?.channels || []).flatMap((channel) =>
      (channel?.__contents || []).map((entry) => ({
        channelName: channel?.name || null,
        message: String(entry?.message || ""),
        time: entry?.__time || null,
      }))
    );
  }

  function parseDamageMessage(entry) {
    const match = entry.message.match(
      /^You lose\s+(\d+)\s+hitpoints\s+due to an attack by\s+(.+?)\.$/i
    );

    if (!match) {
      return null;
    }

    return {
      amount: Number(match[1]),
      attackerName: match[2].trim(),
      time: entry.time,
      channelName: entry.channelName,
      key: `${entry.time || "no-time"}|${entry.message}`,
      message: entry.message,
    };
  }

  function getLatestDamageEvent() {
    const messages = getRecentChannelMessages()
      .map(parseDamageMessage)
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = a.time ? Date.parse(a.time) : 0;
        const bTime = b.time ? Date.parse(b.time) : 0;
        return bTime - aTime;
      });

    return messages[0] || null;
  }

  function triggerPanic(reason, details = {}) {
    if (Date.now() - state.lastTriggerAt < config.triggerCooldownMs) {
      return false;
    }

    state.lastTriggerAt = Date.now();
    bot.playAlarm?.();
    bot.log("panic triggered", { reason, ...details });

    if (bot.cave?.stop) {
      bot.cave.stop();
    }

    if (bot.equipRing?.stop) {
      bot.equipRing.stop();
      bot.ui?.refreshEquipRingStatus?.();
    }

    return !!bot.pz?.goToHomePz?.();
  }

  function triggerGameMasterKillSwitch(players) {
    const detectedPlayers = (players || []).map((player) => player?.name).filter(Boolean);

    bot.playAlarm?.();
    bot.log("game master kill switch triggered", { players: detectedPlayers });

    if (bot.rune?.stop) {
      bot.rune.stop();
    }

    if (bot.eat?.stop) {
      bot.eat.stop();
    }

    if (bot.cave?.stop) {
      bot.cave.stop();
    }

    if (bot.attack?.stop) {
      bot.attack.stop();
    }

    if (bot.equipRing?.stop) {
      bot.equipRing.stop();
    }

    config.unknownPlayerEnabled = false;
    config.healthLossEnabled = false;
    persistConfig();
    stop();

    bot.ui?.refreshPanicStatus?.();
    bot.ui?.refreshRuneStatus?.();
    bot.ui?.refreshAutoEatStatus?.();
    bot.ui?.refreshAutoAttackStatus?.();
    bot.ui?.refreshCaveStatus?.();
    bot.ui?.refreshEquipRingStatus?.();
    return true;
  }

  function checkGameMasters() {
    if (!getGameMasterNames().length) {
      return false;
    }

    const visibleGameMasters = getVisibleGameMasters();
    if (!visibleGameMasters.length) {
      return false;
    }

    return triggerGameMasterKillSwitch(visibleGameMasters);
  }

  function checkUnknownPlayers() {
    if (!config.unknownPlayerEnabled) {
      return false;
    }

    const unknownPlayers = getUnknownVisiblePlayers();
    if (!unknownPlayers.length) {
      return false;
    }

    return triggerPanic("unknown-player", {
      players: unknownPlayers.map((player) => player.name),
    });
  }

  function checkHealthLoss() {
    if (!config.healthLossEnabled) {
      return false;
    }

    const playerState = bot.getPlayerState();
    const currentHealth = Number(playerState?.health ?? 0);

    if (state.lastHealth == null) {
      state.lastHealth = currentHealth;
      return false;
    }

    const lostHealth = currentHealth < state.lastHealth;
    state.lastHealth = currentHealth;

    if (!lostHealth) {
      return false;
    }

    const latestDamageEvent = getLatestDamageEvent();
    if (latestDamageEvent && latestDamageEvent.key !== state.lastDamageEventKey) {
      state.lastDamageEventKey = latestDamageEvent.key;

      const trustedNames = new Set(getTrustedNames());
      const attackerName = normalizeName(latestDamageEvent.attackerName);

      if (attackerName && trustedNames.has(attackerName)) {
        bot.log("ignored health-loss panic because attacker is trusted", {
          attacker: latestDamageEvent.attackerName,
          amount: latestDamageEvent.amount,
          currentHealth,
        });
        return false;
      }

      return triggerPanic("health-loss", {
        currentHealth,
        attacker: latestDamageEvent.attackerName,
        amount: latestDamageEvent.amount,
      });
    }

    const unknownPlayers = getUnknownVisiblePlayers();
    if (!unknownPlayers.length) {
      const trustedPlayers = getTrustedVisiblePlayers();
      if (trustedPlayers.length) {
        bot.log("ignored health-loss panic because only trusted players are nearby", {
          players: trustedPlayers.map((player) => player.name),
          currentHealth,
        });
        return false;
      }
    }

    return triggerPanic("health-loss", { currentHealth });
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
      checkGameMasters() || checkUnknownPlayers() || checkHealthLoss();
    } finally {
      scheduleNextTick();
    }
  }

  function shouldRun() {
    return !!(getGameMasterNames().length || config.unknownPlayerEnabled || config.healthLossEnabled);
  }

  function start() {
    if (state.running) {
      return false;
    }

    state.running = true;
    state.lastHealth = Number(bot.getPlayerState()?.health ?? 0);
    state.lastDamageEventKey = getLatestDamageEvent()?.key || null;
    bot.log("panic runner started", { ...config });
    tick();
    return true;
  }

  function stop() {
    if (!state.running && state.timerId == null) {
      state.lastHealth = null;
      return false;
    }

    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    state.lastHealth = null;
    state.lastDamageEventKey = null;
    bot.log("panic runner stopped");
    return true;
  }

  function syncRunningState() {
    if (shouldRun()) {
      start();
    } else {
      stop();
    }
  }

  function updateConfig(nextConfig = {}) {
    const next = { ...nextConfig };

    if (Array.isArray(next.trustedNames)) {
      next.trustedNames = next.trustedNames
        .map((name) => String(name || "").trim())
        .filter(Boolean);
    }

    if (Array.isArray(next.gameMasterNames)) {
      next.gameMasterNames = next.gameMasterNames
        .map((name) => String(name || "").trim())
        .filter(Boolean);
    }

    Object.assign(config, next);
    persistConfig();
    syncRunningState();
    bot.log("panic runner config updated", { ...config });
    return { ...config };
  }

  function status() {
    return {
      running: state.running,
      config: {
        ...config,
        trustedNames: [...config.trustedNames],
        gameMasterNames: [...config.gameMasterNames],
      },
      visiblePlayers: getVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      unknownVisiblePlayers: getUnknownVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      trustedVisiblePlayers: getTrustedVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      visibleGameMasters: getVisibleGameMasters().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      latestDamageEvent: getLatestDamageEvent(),
      lastTriggerAt: state.lastTriggerAt,
    };
  }

  if (shouldRun()) {
    start();
  }

  bot.panic = {
    start,
    stop,
    status,
    updateConfig,
    getVisiblePlayers,
    getUnknownVisiblePlayers,
    getTrustedVisiblePlayers,
    getVisibleGameMasters,
    getTrustedNames,
    getGameMasterNames,
    config,
  };
};
