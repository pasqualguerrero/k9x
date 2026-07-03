(() => {
  const bundle = window.__minibiaBotBundle || window.__minibiaBotReloadBundle || {};
  const storageKeyMigrations = [
    ["minibiaBot.audio.alarmSrc", "k9x.audio.alarmSrc"],
    ["minibiaBot.rune.config", "k9x.rune.config"],
    ["minibiaBot.heal.config", "k9x.heal.config"],
    ["minibiaBot.invisible.config", "k9x.invisible.config"],
    ["minibiaBot.magicShield.config", "k9x.magicShield.config"],
    ["minibiaBot.attack.config", "k9x.attack.config"],
    ["minibiaBot.cave.config", "k9x.cave.config"],
    ["minibiaBot.cave.route", "k9x.cave.route"],
    ["minibiaBot.cave.transitions", "k9x.cave.transitions"],
    ["minibiaBot.cave.presets", "k9x.cave.presets"],
    ["minibiaBot.equipRing.config", "k9x.equipRing.config"],
    ["minibiaBot.eat.config", "k9x.eat.config"],
    ["minibiaBot.talk.config", "k9x.talk.config"],
    ["minibiaBot.panic.config", "k9x.panic.config"],
    ["minibiaBot.pz.home", "k9x.pz.home"],
    ["minibiaBot.xray.config", "k9x.xray.config"],
    ["minibiaBot.ui.panelPosition", "k9x.ui.panelPosition"],
    ["minibiaBot.ui.panelCollapsed", "k9x.ui.panelCollapsed"],
    ["gameHelper.audio.alarmSrc", "k9x.audio.alarmSrc"],
    ["gameHelper.rune.config", "k9x.rune.config"],
    ["gameHelper.heal.config", "k9x.heal.config"],
    ["gameHelper.invisible.config", "k9x.invisible.config"],
    ["gameHelper.magicShield.config", "k9x.magicShield.config"],
    ["gameHelper.attack.config", "k9x.attack.config"],
    ["gameHelper.cave.config", "k9x.cave.config"],
    ["gameHelper.cave.route", "k9x.cave.route"],
    ["gameHelper.cave.transitions", "k9x.cave.transitions"],
    ["gameHelper.cave.presets", "k9x.cave.presets"],
    ["gameHelper.equipRing.config", "k9x.equipRing.config"],
    ["gameHelper.eat.config", "k9x.eat.config"],
    ["gameHelper.talk.config", "k9x.talk.config"],
    ["gameHelper.panic.config", "k9x.panic.config"],
    ["gameHelper.pz.home", "k9x.pz.home"],
    ["gameHelper.xray.config", "k9x.xray.config"],
    ["gameHelper.ui.panelPosition", "k9x.ui.panelPosition"],
    ["gameHelper.ui.panelCollapsed", "k9x.ui.panelCollapsed"],
  ];
  const persistedEnabledModules = [
    ["rune", "k9x.rune.config"],
    ["heal", "k9x.heal.config"],
    ["invisible", "k9x.invisible.config"],
    ["magicShield", "k9x.magicShield.config"],
    ["attack", "k9x.attack.config"],
    ["cave", "k9x.cave.config"],
    ["equipRing", "k9x.equipRing.config"],
    ["eat", "k9x.eat.config"],
    ["talk", "k9x.talk.config"],
  ];

  function migrateLegacyStorageKeys() {
    storageKeyMigrations.forEach(([legacyKey, nextKey]) => {
      if (!legacyKey || !nextKey || legacyKey === nextKey) {
        return;
      }

      try {
        const legacyValue = window.localStorage.getItem(legacyKey);
        if (legacyValue == null) {
          return;
        }

        const nextValue = window.localStorage.getItem(nextKey);
        if (nextValue == null) {
          window.localStorage.setItem(nextKey, legacyValue);
        }

        window.localStorage.removeItem(legacyKey);
      } catch (error) {
        console.error("[minibia-bot] failed to migrate storage key", {
          legacyKey,
          nextKey,
          error,
        });
      }
    });
  }

  function getPersistedEnabledSnapshot(bot) {
    const snapshot = {};
    const status = typeof bot?.status === "function" ? bot.status() : null;

    persistedEnabledModules.forEach(([moduleName]) => {
      const enabled = status?.[moduleName]?.config?.enabled;
      if (typeof enabled === "boolean") {
        snapshot[moduleName] = enabled;
      }
    });

    return snapshot;
  }

  function restorePersistedEnabledSnapshot(snapshot) {
    persistedEnabledModules.forEach(([moduleName, storageKey]) => {
      if (typeof snapshot?.[moduleName] !== "boolean") {
        return;
      }

      try {
        const rawValue = window.localStorage.getItem(storageKey);
        const config = rawValue ? JSON.parse(rawValue) : {};
        config.enabled = snapshot[moduleName];
        window.localStorage.setItem(storageKey, JSON.stringify(config));
      } catch (error) {
        console.error("[minibia-bot] failed to restore persisted enabled state", {
          module: moduleName,
          error,
        });
      }
    });
  }

  function boot(currentBundle = bundle) {
    migrateLegacyStorageKeys();
    const previousEnabledSnapshot = getPersistedEnabledSnapshot(window.minibiaBot);

    if (window.minibiaBot?.destroy) {
      window.minibiaBot.destroy();
    }

    restorePersistedEnabledSnapshot(previousEnabledSnapshot);

    const bot = currentBundle.createBot();

    currentBundle.installPzModule(bot);
    currentBundle.installXrayModule(bot);
    currentBundle.installPanicModule(bot);
    currentBundle.installRuneModule(bot);
    currentBundle.installHealModule(bot);
    currentBundle.installAutoInvisibleModule(bot);
    currentBundle.installAutoMagicShieldModule(bot);
    currentBundle.installAutoAttackModule(bot);
    currentBundle.installCaveModule(bot);
    currentBundle.installEquipRingModule(bot);
    currentBundle.installAutoEatModule(bot);
    currentBundle.installTalkModule(bot);
    currentBundle.installPanel(bot);

    bot.ui.inject();

    bot.start = (...args) => bot.rune.start(...args);
    bot.stop = (...args) => bot.rune.stop(...args);
    bot.reload = () => window.minibiaBotReload?.();
    bot.status = () => ({
      version: bot.version,
      pz: {
        home: bot.pz.getHomePz(),
      },
      xray: bot.xray.status(),
      panic: bot.panic.status(),
      rune: bot.rune.status(),
      heal: bot.heal.status(),
      invisible: bot.invisible.status(),
      magicShield: bot.magicShield.status(),
      attack: bot.attack.status(),
      cave: bot.cave.status(),
      equipRing: bot.equipRing.status(),
      eat: bot.eat.status(),
      talk: bot.talk.status(),
    });

    window.minibiaBot = bot;
    window.pzBot = bot.pz;

    console.log("[minibia-bot] ready", {
      version: bot.version,
      modules: ["pz", "xray", "panic", "rune", "heal", "invisible", "magicShield", "attack", "cave", "equipRing", "eat", "talk", "ui"],
    });
    console.log("minibiaBot.reload()");
    console.log("minibiaBot.xray.status()");
    console.log("minibiaBot.panic.status()");
    console.log("minibiaBot.pz.goToNearestPz()");
    console.log("minibiaBot.pz.setHomePzCurrentSpot()");
    console.log("minibiaBot.pz.goToHomePz()");
    console.log("minibiaBot.rune.start()");
    console.log("minibiaBot.rune.stop()");
    console.log("minibiaBot.heal.start()");
    console.log("minibiaBot.heal.stop()");
    console.log("minibiaBot.invisible.start()");
    console.log("minibiaBot.invisible.stop()");
    console.log("minibiaBot.magicShield.start()");
    console.log("minibiaBot.magicShield.stop()");
    console.log("minibiaBot.attack.start()");
    console.log("minibiaBot.attack.stop()");
    console.log("minibiaBot.cave.addWaypointCurrentSpot()");
    console.log("minibiaBot.cave.start()");
    console.log("minibiaBot.cave.stop()");
    console.log("minibiaBot.equipRing.start()");
    console.log("minibiaBot.equipRing.stop()");
    console.log("minibiaBot.eat.start()");
    console.log("minibiaBot.eat.stop()");
    console.log("minibiaBot.talk.updateConfig({ apiKey: \"...\" })");
    console.log("minibiaBot.talk.start()");
    console.log("minibiaBot.talk.stop()");
    return bot;
  }

  window.__minibiaBotReloadBundle = bundle;
  window.minibiaBotReload = () => boot(window.__minibiaBotReloadBundle || bundle);
  delete window.__minibiaBotBundle;
  boot(bundle);
})();
