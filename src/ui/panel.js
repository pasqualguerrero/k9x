window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installPanel = function installPanel(bot) {
  const panelPositionKey = "k9x.ui.panelPosition";
  const panelCollapsedKey = "k9x.ui.panelCollapsed";
  const sectionCollapsedKey = "k9x.ui.sectionCollapsed";

  function destroy() {
    document.getElementById("k9x-panel")?.remove();
    document.getElementById("k9x-style")?.remove();
  }

  function savePanelPosition(position, key = panelPositionKey) {
    bot.storage.set(key, position);
  }

  function getSavedPanelPosition(key = panelPositionKey) {
    return bot.storage.get(key, null);
  }

  function savePanelCollapsed(collapsed) {
    bot.storage.set(panelCollapsedKey, !!collapsed);
  }

  function getSavedPanelCollapsed() {
    return !!bot.storage.get(panelCollapsedKey, false);
  }

  function getSavedSectionCollapsed() {
    const saved = bot.storage.get(sectionCollapsedKey, {});
    return saved && typeof saved === "object" ? saved : {};
  }

  function saveSectionCollapsed(state) {
    bot.storage.set(sectionCollapsedKey, state);
  }

  function setSectionCollapsed(section, collapsed) {
    if (!section) return;

    const nextCollapsed = !!collapsed;
    const header = section.querySelector(".mb-collapsible-header");
    const body = section.querySelector(".mb-collapsible-body");
    const toggle = section.querySelector(".mb-collapsible-toggle");

    section.dataset.sectionCollapsed = nextCollapsed ? "true" : "false";

    if (header) {
      header.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
    }

    if (body) {
      body.hidden = nextCollapsed;
    }

    if (toggle) {
      toggle.textContent = nextCollapsed ? "+" : "−";
    }
  }

  function enableCollapsibleSections(panel) {
    const saved = { ...getSavedSectionCollapsed() };

    panel.querySelectorAll("[data-collapsible]").forEach((section) => {
      const key = section.dataset.collapsible;
      if (!key) return;

      setSectionCollapsed(section, !!saved[key]);

      const header = section.querySelector(".mb-collapsible-header");
      header?.addEventListener("click", () => {
        const nextCollapsed = section.dataset.sectionCollapsed !== "true";
        setSectionCollapsed(section, nextCollapsed);
        saved[key] = nextCollapsed;
        saveSectionCollapsed(saved);
      });
    });
  }

  function refreshHomeLabel() {
    const homeLabel = document.getElementById("k9x-home");
    if (!homeLabel) return;

    const home = bot.pz?.getHomePz?.();
    homeLabel.textContent = home
      ? `Panic Runner Home: ${home.x}, ${home.y}, ${home.z}`
      : "Panic Runner Home: not set";
  }

  function refreshPanicStatus() {
    const unknownToggle = document.getElementById("k9x-panic-unknown");
    const healthToggle = document.getElementById("k9x-panic-health");
    const returnToggle = document.getElementById("k9x-panic-return");
    const whisperToggle = document.getElementById("k9x-panic-whisper");
    const status = bot.panic?.status?.();

    if (unknownToggle) {
      unknownToggle.checked = !!status?.config?.unknownPlayerEnabled;
    }

    if (healthToggle) {
      healthToggle.checked = !!status?.config?.healthLossEnabled;
    }

    if (returnToggle) {
      returnToggle.checked = !!status?.config?.returnToOriginEnabled;
    }

    if (whisperToggle) {
      whisperToggle.checked = !!status?.config?.whisperAlarmEnabled;
    }
  }

  function refreshXrayStatus() {
    const status = bot.xray?.status?.();
    const me = bot.getPlayerPosition?.();
    const overlayButton = document.getElementById("k9x-xray-overlay-toggle");
    const overlayLabel = document.getElementById("k9x-xray-overlay-status");
    const floorSelect = document.getElementById("k9x-xray-floor-select");
    const formatFloorOffset = (floor) => {
      if (!me || floor == null) {
        return null;
      }

      const offset = me.z - floor;
      return offset === 0 ? "0" : offset > 0 ? `+${offset}` : `${offset}`;
    };

    if (overlayButton) {
      overlayButton.textContent = status?.config?.overlayEnabled ? "Disable Overlay" : "Enable Overlay";
    }

    if (overlayLabel) {
      const floorLabel = status?.config?.selectedFloor == null
        ? "all floors"
        : `${formatFloorOffset(status.config.selectedFloor) ?? "?"}`;
      overlayLabel.textContent = `${status?.config?.overlayEnabled ? "Overlay: on" : "Overlay: off"} • ${floorLabel}`;
    }

    if (floorSelect) {
      const floors = Array.from(
        new Set(
          (status?.visibleCreatures || [])
            .map((creature) => creature?.position?.z)
            .filter((floor) => floor != null)
        )
      ).sort((a, b) => a - b);
      const selectedFloor = status?.config?.selectedFloor;

      if (selectedFloor != null && !floors.includes(selectedFloor)) {
        floors.push(selectedFloor);
        floors.sort((a, b) => a - b);
      }

      floorSelect.innerHTML = "";

      const allOption = document.createElement("option");
      allOption.value = "all";
      allOption.textContent = "All floors";
      floorSelect.appendChild(allOption);

      floors.forEach((floor) => {
        const option = document.createElement("option");
        option.value = String(floor);
        const offsetLabel = formatFloorOffset(floor);
        option.textContent = offsetLabel == null
          ? String(floor)
          : offsetLabel;
        floorSelect.appendChild(option);
      });

      floorSelect.value = selectedFloor == null ? "all" : String(selectedFloor);
    }
  }

  function renderTrustedNames() {
    const list = document.getElementById("k9x-panic-trusted-list");
    if (!list) return;

    const trustedNames = bot.panic?.config?.trustedNames || [];
    list.innerHTML = "";

    if (!trustedNames.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "No trusted names saved.";
      list.appendChild(empty);
      return;
    }

    trustedNames.forEach((name, index) => {
      const row = document.createElement("div");
      row.className = "mb-list-row";

      const label = document.createElement("span");
      label.textContent = name;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "mb-small-button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        const nextNames = trustedNames.filter((_, currentIndex) => currentIndex !== index);
        bot.panic.updateConfig({ trustedNames: nextNames });
        renderTrustedNames();
      });

      row.appendChild(label);
      row.appendChild(removeButton);
      list.appendChild(row);
    });
  }

  function renderGameMasterNames() {
    const list = document.getElementById("k9x-panic-gm-list");
    if (!list) return;

    const gameMasterNames = bot.panic?.config?.gameMasterNames || [];
    list.innerHTML = "";

    if (!gameMasterNames.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "No game master names saved.";
      list.appendChild(empty);
      return;
    }

    gameMasterNames.forEach((name, index) => {
      const row = document.createElement("div");
      row.className = "mb-list-row";

      const label = document.createElement("span");
      label.textContent = name;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "mb-small-button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        const nextNames = gameMasterNames.filter((_, currentIndex) => currentIndex !== index);
        bot.panic.updateConfig({ gameMasterNames: nextNames });
        renderGameMasterNames();
      });

      row.appendChild(label);
      row.appendChild(removeButton);
      list.appendChild(row);
    });
  }

  function refreshRuneStatus() {
    const runeToggle = document.getElementById("k9x-rune-enabled");
    const runeStatusNote = document.getElementById("k9x-rune-status");
    const status = bot.rune?.status?.();
    const running = !!status?.running;

    if (runeToggle) {
      runeToggle.checked = running;
    }

    if (runeStatusNote && status) {
      const gates = status.gates || {};

      if (!running) {
        runeStatusNote.textContent = "Status: stopped";
      } else if (!gates.hasStats) {
        runeStatusNote.textContent = "Status: running (waiting for player stats)";
      } else if (gates.canMakeRune) {
        runeStatusNote.textContent = "Status: running (ready to cast)";
      } else {
        const waiting = [];
        if (!gates.enoughHp) waiting.push("HP");
        if (!gates.enoughMana) waiting.push("mana");
        if (!gates.hasCastMethod) waiting.push("hotkey or spell");
        if (!gates.enoughFood) waiting.push("food");
        if (!gates.cooldownReady) waiting.push("cooldown");
        runeStatusNote.textContent = `Status: running (waiting: ${waiting.join(", ")})`;
      }
    }
  }

  function refreshAutoEatStatus() {
    const autoEatToggle = document.getElementById("k9x-auto-eat-enabled");
    if (!autoEatToggle) return;

    autoEatToggle.checked = !!bot.eat?.status?.().running;
  }

  function refreshAutoFishingStatus() {
    const autoFishingToggle = document.getElementById("k9x-auto-fishing-enabled");
    if (!autoFishingToggle) return;

    autoFishingToggle.checked = !!bot.fishing?.status?.().running;
  }

  function refreshAutoHealStatus() {
    const autoHealToggle = document.getElementById("k9x-auto-heal-enabled");
    if (!autoHealToggle) return;

    autoHealToggle.checked = !!bot.heal?.status?.().running;
  }

  function refreshAutoInvisibleStatus() {
    const autoInvisibleToggle = document.getElementById("k9x-auto-invisible-enabled");
    if (!autoInvisibleToggle) return;

    autoInvisibleToggle.checked = !!bot.invisible?.status?.().running;
  }

  function refreshAutoMagicShieldStatus() {
    const autoMagicShieldToggle = document.getElementById("k9x-auto-magic-shield-enabled");
    if (!autoMagicShieldToggle) return;

    autoMagicShieldToggle.checked = !!bot.magicShield?.status?.().running;
  }

  function refreshAutoAttackStatus() {
    const autoAttackToggle = document.getElementById("k9x-auto-attack-enabled");
    if (!autoAttackToggle) return;

    autoAttackToggle.checked = !!bot.attack?.status?.().running;
  }

  function refreshAutoAttackFilterControls() {
    const modeSelect = document.getElementById("k9x-auto-attack-filter-mode");
    const includeList = document.getElementById("k9x-auto-attack-include-list");
    const excludeList = document.getElementById("k9x-auto-attack-exclude-list");
    const config = bot.attack?.config || {};
    const includedNames = Array.isArray(config.includedCreatureNames) ? config.includedCreatureNames : [];
    const excludedNames = Array.isArray(config.excludedCreatureNames) ? config.excludedCreatureNames : [];
    const mode = config.targetFilterMode === "include" || config.targetFilterMode === "exclude"
      ? config.targetFilterMode
      : "all";

    if (modeSelect) {
      modeSelect.value = mode;
    }

    const renderNameList = (container, names, key) => {
      if (!container) {
        return;
      }

      container.innerHTML = "";
      if (!names.length) {
        const empty = document.createElement("div");
        empty.className = "mb-small-note";
        empty.textContent = "No names added.";
        container.appendChild(empty);
        return;
      }

      names.forEach((name, index) => {
        const row = document.createElement("div");
        row.className = "mb-list-row";

        const label = document.createElement("span");
        label.textContent = name;

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "mb-small-button";
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => {
          const nextNames = names.filter((_, currentIndex) => currentIndex !== index);
          bot.attack.updateConfig({ [key]: nextNames });
          refreshAutoAttackFilterControls();
        });

        row.appendChild(label);
        row.appendChild(removeButton);
        container.appendChild(row);
      });
    };

    renderNameList(includeList, includedNames, "includedCreatureNames");
    renderNameList(excludeList, excludedNames, "excludedCreatureNames");
  }

  function refreshCaveStatus() {
    const statusLabel = document.getElementById("k9x-cave-status");
    const startButton = document.getElementById("k9x-cave-start");
    const stopButton = document.getElementById("k9x-cave-stop");
    const route = bot.cave?.getRoute?.() || [];
    const status = bot.cave?.status?.();

    if (statusLabel) {
      const modeLabel = status?.config?.cycleWaypoints ? "cycle" : "bounce";
      if (!route.length) {
        statusLabel.textContent = "Status: no waypoints";
      } else if (status?.running) {
        const waypointNumber = (status.currentIndex ?? 0) + 1;
        const distanceLabel =
          Number.isFinite(status?.distanceToWaypoint) && status.distanceToWaypoint >= 0
            ? `, dist ${status.distanceToWaypoint}`
            : "";
        statusLabel.textContent = `Status: running (${waypointNumber}/${route.length}${distanceLabel}, ${modeLabel})`;
      } else {
        statusLabel.textContent = `Status: idle (${route.length} waypoint${route.length === 1 ? "" : "s"}, ${modeLabel})`;
      }
    }

    if (startButton) {
      startButton.disabled = !route.length || !!status?.running;
    }

    if (stopButton) {
      stopButton.disabled = !status?.running;
    }
  }

  function refreshCaveModeStatus() {
    const caveCycleToggle = document.getElementById("k9x-cave-cycle");
    const status = bot.cave?.status?.();

    if (!caveCycleToggle) {
      return;
    }

    caveCycleToggle.checked = !!status?.config?.cycleWaypoints;
  }

  function refreshCavePresetControls() {
    const select = document.getElementById("k9x-cave-preset-select");
    const label = document.getElementById("k9x-cave-preset-status");
    const deleteButton = document.getElementById("k9x-cave-preset-delete");
    const status = bot.cave?.status?.();
    const presetNames = status?.presetNames || bot.cave?.getPresetNames?.() || [];
    const activePresetName = status?.activePresetName || bot.cave?.getActivePresetName?.() || "Default";

    if (select) {
      const previousValue = select.value;
      select.innerHTML = "";

      if (!presetNames.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No saved presets";
        select.appendChild(option);
        select.disabled = true;
      } else {
        presetNames.forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          select.appendChild(option);
        });
        select.disabled = false;
        const nextValue = presetNames.includes(activePresetName) ? activePresetName : previousValue;
        if (nextValue) {
          select.value = nextValue;
        }
      }
    }

    if (label) {
      label.textContent = presetNames.length
        ? `Preset: ${activePresetName} (${presetNames.length} saved)`
        : `Preset: ${activePresetName}`;
    }

    if (deleteButton) {
      deleteButton.disabled = !presetNames.length || !select?.value;
    }
  }

  function refreshCaveClosestStatus() {
    const label = document.getElementById("k9x-cave-closest");
    if (!label) return;

    const position = bot.getPlayerPosition?.();
    const route = bot.cave?.getRoute?.() || [];

    if (!position) {
      label.textContent = "Closest start: current position unavailable";
      return;
    }

    if (!route.length) {
      label.textContent = "Closest start: no waypoints";
      return;
    }

    const closestIndex = bot.cave?.findClosestWaypointIndex?.(position) ?? 0;
    const waypoint = route[closestIndex];

    if (!waypoint) {
      label.textContent = "Closest start: unavailable";
      return;
    }

    label.textContent = `Closest start: ${closestIndex + 1}. ${waypoint.x}, ${waypoint.y}, ${waypoint.z}`;
  }

  function refreshCaveTransitionStatus() {
    const label = document.getElementById("k9x-cave-transition-status");
    if (!label) return;

    const transitions = bot.cave?.getTransitions?.() || [];
    if (!transitions.length) {
      label.textContent = "Transitions learned: none";
      return;
    }

    const latest = transitions
      .slice()
      .sort((a, b) => Number(b?.lastSeenAt || 0) - Number(a?.lastSeenAt || 0))[0];

    if (!latest?.from || !latest?.to) {
      label.textContent = `Transitions learned: ${transitions.length}`;
      return;
    }

    const extra = transitions.length > 1 ? ` (+${transitions.length - 1} more)` : "";
    label.textContent =
      `Transitions learned: ${latest.from.x}, ${latest.from.y}, ${latest.from.z} -> ` +
      `${latest.to.x}, ${latest.to.y}, ${latest.to.z}${extra}`;
  }

  function refreshEquipRingStatus() {
    const equipRingToggle = document.getElementById("k9x-equip-ring-enabled");
    if (!equipRingToggle) return;

    equipRingToggle.checked = !!bot.equipRing?.status?.().running;
  }

  function refreshTalkStatus() {
    const talkToggle = document.getElementById("k9x-talk-enabled");
    const statusLabel = document.getElementById("k9x-talk-status");
    const status = bot.talk?.status?.();

    if (talkToggle) {
      talkToggle.checked = !!status?.running;
    }

    if (statusLabel) {
      if (!status?.config?.apiKey) {
        statusLabel.textContent = "Status: API key missing";
      } else if (status?.pending) {
        statusLabel.textContent = "Status: generating";
      } else if (status?.running) {
        statusLabel.textContent = "Status: listening to Default";
      } else {
        statusLabel.textContent = "Status: idle";
      }
    }
  }

  function refreshVisibleCreatures() {
    const list = document.getElementById("k9x-visible-creatures-list");
    if (!list) return;

    const me = bot.getPlayerPosition?.();
    const status = bot.xray?.status?.();
    const creatures = status?.visibleCreatures || [];
    const selectedFloor = status?.config?.selectedFloor;
    list.innerHTML = "";

    if (!me) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "Current position unavailable.";
      list.appendChild(empty);
      return;
    }

    const getFloorOffset = (creature) => (creature.position?.z || 0) - me.z;
    const getFloorDistance = (creature) => Math.abs(getFloorOffset(creature));

    const visibleCreatures = creatures
      .filter((creature) => {
        const floor = creature?.position?.z;
        if (floor == null) {
          return false;
        }

        if (selectedFloor != null) {
          return floor === selectedFloor;
        }

        return floor !== me.z;
      })
      .sort((a, b) => {
      const floorDistanceDiff = getFloorDistance(a) - getFloorDistance(b);
      if (floorDistanceDiff !== 0) return floorDistanceDiff;

      const floorOffsetDiff = getFloorOffset(a) - getFloorOffset(b);
      if (floorOffsetDiff !== 0) return floorOffsetDiff;

      const aDist = Math.abs((a.position?.x || 0) - me.x) + Math.abs((a.position?.y || 0) - me.y);
      const bDist = Math.abs((b.position?.x || 0) - me.x) + Math.abs((b.position?.y || 0) - me.y);
      return aDist - bDist;
    });

    if (!visibleCreatures.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = selectedFloor == null
        ? "No off-floor creatures."
        : `No creatures on floor ${selectedFloor}.`;
      list.appendChild(empty);
      return;
    }

    let currentFloor = null;

    visibleCreatures.forEach((creature) => {
      const floor = creature.position?.z;
      if (floor !== currentFloor) {
        currentFloor = floor;
        const floorOffset = me.z - floor;
        const floorOffsetLabel =
          floorOffset === 0 ? "0" : floorOffset > 0 ? `+${floorOffset}` : `${floorOffset}`;

        const floorLabel = document.createElement("div");
        floorLabel.className = "mb-floor-label";
        floorLabel.textContent = floorOffsetLabel;
        list.appendChild(floorLabel);
      }

      const row = document.createElement("div");
      row.className = "mb-creature-row";

      const name = document.createElement("div");
      name.className = "mb-creature-name";
      name.textContent = creature.name || (creature.type === 0 ? "Player" : "Mob");

      const meta = document.createElement("div");
      meta.className = "mb-small-note";
      meta.textContent = `${creature.type === 0 ? "Player" : "Mob"} at ${creature.position.x}, ${creature.position.y}, ${creature.position.z}`;

      row.appendChild(name);
      row.appendChild(meta);
      list.appendChild(row);
    });
  }

  function setPanelCollapsed(panel, collapsed) {
    if (!panel) return;

    const body = panel.querySelector(".mb-body");
    const toggle = panel.querySelector("#k9x-collapse");
    const nextCollapsed = !!collapsed;

    panel.dataset.collapsed = nextCollapsed ? "true" : "false";

    if (body) {
      body.hidden = nextCollapsed;
    }

    if (toggle) {
      toggle.textContent = nextCollapsed ? "+" : "−";
      toggle.setAttribute("aria-label", nextCollapsed ? "Maximize panel" : "Minimize panel");
      toggle.setAttribute("title", nextCollapsed ? "Maximize" : "Minimize");
    }

    savePanelCollapsed(nextCollapsed);
  }

  function applySavedPanelPosition(panel, key = panelPositionKey) {
    const position = getSavedPanelPosition(key);
    if (!position) return;

    if (typeof position.top === "number") {
      panel.style.top = `${position.top}px`;
    }

    if (typeof position.left === "number") {
      panel.style.left = `${position.left}px`;
      panel.style.right = "auto";
    }
  }

  function clampPanelPosition(panel, left, top) {
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);

    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  }

  function enableDrag(panel, key = panelPositionKey) {
    const handle = panel.querySelector(".mb-title");
    if (!handle) return;

    let dragState = null;

    const onMouseMove = (event) => {
      if (!dragState) return;

      const next = clampPanelPosition(
        panel,
        event.clientX - dragState.offsetX,
        event.clientY - dragState.offsetY
      );

      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
      panel.style.right = "auto";
    };

    const onMouseUp = () => {
      if (!dragState) return;

      dragState = null;
      const rect = panel.getBoundingClientRect();
      savePanelPosition({ left: rect.left, top: rect.top }, key);
    };

    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;

      const rect = panel.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };

      event.preventDefault();
    });

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    bot.addCleanup(() => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    });
  }

  function inject() {
    destroy();

    const style = document.createElement("style");
    style.id = "k9x-style";
    style.textContent = `
      #k9x-panel {
        position: fixed;
        z-index: 999999;
        max-width: calc(100vw - 32px);
        padding: 12px;
        border: 1px solid rgba(112, 168, 170, 0.42);
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(15, 22, 24, 0.96), rgba(8, 12, 14, 0.98));
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        color: #c6dfdd;
        font: 12px/1.35 Verdana, sans-serif;
        user-select: none;
      }

      #k9x-panel {
        top: 16px;
        right: 16px;
        width: 1180px;
      }

      #k9x-panel[data-collapsed="true"] {
        width: 220px;
      }

      #k9x-panel .mb-title {
        margin: 0;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        cursor: move;
      }

      #k9x-panel .mb-titlebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 0 0 8px;
      }

      #k9x-panel .mb-icon-button {
        width: 24px;
        min-width: 24px;
        padding: 2px 0;
        border-radius: 6px;
        font-weight: 700;
        line-height: 1;
      }

      #k9x-panel[data-collapsed="true"] .mb-titlebar {
        margin-bottom: 0;
      }

      #k9x-panel .mb-body {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        align-items: start;
      }

      #k9x-panel .mb-body[hidden] {
        display: none !important;
      }

      #k9x-panel .mb-side-column,
      #k9x-panel .mb-main-column,
      #k9x-panel .mb-talk-column,
      #k9x-panel .mb-cave-column {
        display: grid;
        gap: 10px;
      }

      #k9x-panel .mb-section {
        padding-top: 10px;
        border-top: 1px solid rgba(112, 168, 170, 0.2);
      }

      #k9x-panel .mb-column-section:first-child {
        padding-top: 0;
        border-top: 0;
      }

      #k9x-panel .mb-label {
        margin: 0 0 8px;
        color: #a9c5c3;
        word-break: break-word;
      }

      #k9x-panel .mb-actions {
        display: grid;
        gap: 6px;
      }

      #k9x-panel .mb-actions-inline-three {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      #k9x-panel .mb-actions-inline-two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      #k9x-panel button {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid rgba(112, 168, 170, 0.36);
        border-radius: 8px;
        background: linear-gradient(180deg, #30474a, #1f2f32);
        color: #d3ebe8;
        font: inherit;
        cursor: pointer;
      }

      #k9x-panel button:hover {
        background: linear-gradient(180deg, #3a5659, #24393c);
      }

      #k9x-panel .mb-collapsible-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        margin: 0 0 8px;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #a9c5c3;
        font: inherit;
        font-weight: 700;
        text-align: left;
        cursor: pointer;
      }

      #k9x-panel .mb-collapsible-header:hover {
        background: transparent;
        color: #d3ebe8;
      }

      #k9x-panel .mb-collapsible-header .mb-label {
        margin: 0;
      }

      #k9x-panel .mb-collapsible-toggle {
        flex-shrink: 0;
        width: 20px;
        text-align: center;
        color: #88a7a5;
        font-weight: 700;
        line-height: 1;
      }

      #k9x-panel .mb-collapsible[data-section-collapsed="true"] .mb-collapsible-header {
        margin-bottom: 0;
      }

      #k9x-panel .mb-collapsible-body[hidden] {
        display: none !important;
      }

      #k9x-panel input,
      #k9x-panel textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border: 1px solid rgba(112, 168, 170, 0.34);
        border-radius: 8px;
        background: rgba(8, 14, 16, 0.9);
        color: #d3ebe8;
        font: inherit;
      }

      #k9x-panel textarea {
        min-height: 72px;
        resize: vertical;
      }

      #k9x-panel .mb-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #a9c5c3;
      }

      #k9x-panel .mb-toggle input[type="checkbox"] {
        width: auto;
        margin: 0;
      }

      #k9x-panel .mb-row {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 8px;
      }

      #k9x-panel .mb-row-compact {
        grid-template-columns: auto auto;
        justify-content: start;
      }

      #k9x-panel .mb-row .mb-toggle {
        white-space: nowrap;
      }

      #k9x-panel .mb-row input[type="text"] {
        min-width: 0;
      }

      #k9x-panel .mb-row-three {
        display: grid;
        grid-template-columns: auto minmax(120px, 1fr) 72px;
        align-items: center;
        gap: 8px;
      }

      #k9x-panel .mb-row-three input[type="text"],
      #k9x-panel .mb-row-three input[type="number"] {
        min-width: 0;
      }

      #k9x-panel .mb-row-five {
        display: grid;
        grid-template-columns: auto 82px 72px 82px 72px;
        align-items: center;
        gap: 8px;
      }

      #k9x-panel .mb-row-five input[type="number"] {
        min-width: 0;
      }

      #k9x-panel .mb-field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      #k9x-panel .mb-field {
        display: grid;
        gap: 4px;
      }

      #k9x-panel .mb-field-compact {
        width: 96px;
        justify-self: end;
      }

      #k9x-panel .mb-field-label {
        color: #a9c5c3;
        font-size: 11px;
      }

      #k9x-panel .mb-stack {
        display: grid;
        gap: 8px;
      }

      #k9x-panel .mb-inline {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
      }

      #k9x-panel .mb-list {
        display: grid;
        gap: 6px;
      }

      #k9x-panel .mb-list-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
        color: #a9c5c3;
      }

      #k9x-panel .mb-creature-row {
        padding: 6px 8px;
        border: 1px solid rgba(112, 168, 170, 0.18);
        border-radius: 8px;
        background: rgba(162, 218, 220, 0.04);
      }

      #k9x-panel .mb-creature-name {
        color: #d3ebe8;
        word-break: break-word;
      }

      #k9x-panel .mb-floor-label {
        margin-top: 4px;
        color: #9ec6c3;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      #k9x-panel #k9x-visible-creatures-list {
        max-height: 150px;
        overflow-y: auto;
        padding-right: 2px;
      }

      #k9x-panel #k9x-panic-trusted-list {
        max-height: 140px;
        overflow-y: auto;
        padding-right: 2px;
      }

      #k9x-panel .mb-small-button {
        width: auto;
        padding: 4px 8px;
        border-radius: 6px;
      }

      #k9x-panel .mb-small-note {
        color: #88a7a5;
        font-size: 11px;
      }

      #k9x-panel .mb-note {
        margin-top: 8px;
        color: #88a7a5;
        font-size: 11px;
      }

      #k9x-panel .mb-footer {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid rgba(112, 168, 170, 0.2);
        text-align: right;
        font-size: 10px;
        color: #88a7a5;
      }

      #k9x-panel .mb-footer a {
        color: #9ccfcd;
        text-decoration: none;
      }

      #k9x-panel .mb-footer a:hover {
        color: #bde7e4;
        text-decoration: underline;
      }

      #k9x-panel[data-collapsed="true"] .mb-footer {
        display: none;
      }

      @media (max-width: 760px) {
        #k9x-panel {
          width: min(900px, calc(100vw - 32px));
        }

        #k9x-panel .mb-body {
          grid-template-columns: 1fr;
        }

        #k9x-panel .mb-field-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.id = "k9x-panel";
    panel.innerHTML = `
        <div class="mb-titlebar">
        <div class="mb-title">K9X</div>
        <button type="button" class="mb-icon-button" id="k9x-collapse" aria-label="Minimize panel" title="Minimize">−</button>
      </div>
      <div class="mb-body">
        <div class="mb-main-column">
          <div class="mb-actions mb-column-section">
            <button type="button" id="k9x-reload">Reload Bot</button>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="panic">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title mb-label" id="k9x-home">Panic Runner Home: not set</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <button type="button" id="k9x-set-home">Set Home</button>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-panic-unknown" />
                <span>Unknown Player</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-panic-health" />
                <span>Lose Health</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-panic-return" />
                <span>Auto Return</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-panic-whisper" />
                <span>Whisper Alarm</span>
              </label>
              <div class="mb-small-note">Whisper alarm plays sound only (no flee) for nearby whispers and private messages. Trusted names are ignored.</div>
              <div class="mb-inline">
                <input type="text" id="k9x-panic-trusted-input" placeholder="Trusted name" />
                <button type="button" class="mb-small-button" id="k9x-panic-trusted-add">Add</button>
              </div>
              <div class="mb-list" id="k9x-panic-trusted-list"></div>
            </div>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="gm-kill">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">GM Kill Switch</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <div class="mb-inline">
                <input type="text" id="k9x-panic-gm-input" placeholder="Game master name" />
                <button type="button" class="mb-small-button" id="k9x-panic-gm-add">Add</button>
              </div>
              <div class="mb-list" id="k9x-panic-gm-list"></div>
            </div>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="routines">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Quick Routines</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-actions">
              <div class="mb-row mb-row-compact">
                <label class="mb-toggle">
                  <input type="checkbox" id="k9x-auto-eat-enabled" />
                  <span>Auto Eat</span>
                </label>
                <label class="mb-field mb-field-compact" for="k9x-auto-eat-hotkey">
                  <span class="mb-field-label">Eat Hotkey (1-12)</span>
                  <input type="number" id="k9x-auto-eat-hotkey" min="1" max="12" placeholder="10" />
                </label>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="k9x-auto-fishing-enabled" />
                  <span>Auto Fishing</span>
                </label>
                <div class="mb-small-note">On enable it asks for the rod hotkey slot, then uses it and left-clicks fast (about every 200ms). Right-click disables it.</div>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="k9x-auto-invisible-enabled" />
                  <span>Auto Invisible</span>
                </label>
                <div class="mb-small-note">Casts utana vid whenever invisibility is not active.</div>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="k9x-auto-magic-shield-enabled" />
                  <span>Auto Utamo Vita</span>
                </label>
                <div class="mb-small-note">Casts utamo vita whenever magic shield is not active.</div>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="k9x-equip-ring-enabled" />
                  <span>Equip Ring</span>
                </label>
                <div></div>
              </div>
            </div>
          </div>
        </div>
        <div class="mb-side-column">
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="xray">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Xray</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <button type="button" class="mb-small-button" id="k9x-xray-overlay-toggle">Disable Overlay</button>
              <div class="mb-small-note" id="k9x-xray-overlay-status">Overlay: on</div>
              <label class="mb-field" for="k9x-xray-floor-select">
                <span class="mb-field-label">Floor Filter</span>
                <select id="k9x-xray-floor-select">
                  <option value="all">All floors</option>
                </select>
              </label>
              <div class="mb-list" id="k9x-visible-creatures-list"></div>
            </div>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="rune">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Magic Level Trainer</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-rune-enabled" />
                <span>Enable Magic Level Trainer</span>
              </label>
              <div class="mb-field-grid">
                <label class="mb-field" for="k9x-rune-spell">
                  <span class="mb-field-label">Spell Words</span>
                  <input type="text" id="k9x-rune-spell" placeholder="adori vita vis" />
                </label>
                <label class="mb-field" for="k9x-rune-hotkey">
                  <span class="mb-field-label">Spell Hotkey (1-12)</span>
                  <input type="number" id="k9x-rune-hotkey" min="1" max="12" placeholder="optional" />
                </label>
                <label class="mb-field" for="k9x-rune-mana">
                  <span class="mb-field-label">Mana Cost</span>
                  <input type="number" id="k9x-rune-mana" min="0" placeholder="600" />
                </label>
                <label class="mb-field" for="k9x-rune-min-hp">
                  <span class="mb-field-label">Min HP (%)</span>
                  <input type="number" id="k9x-rune-min-hp" min="0" max="100" placeholder="50" />
                </label>
                <label class="mb-field" for="k9x-rune-min-food">
                  <span class="mb-field-label">Min Food (sec)</span>
                  <input type="number" id="k9x-rune-min-food" min="0" placeholder="30" />
                </label>
                <label class="mb-field" for="k9x-rune-cooldown">
                  <span class="mb-field-label">Cooldown (ms)</span>
                  <input type="number" id="k9x-rune-cooldown" min="0" placeholder="3500" />
                </label>
              </div>
              <div class="mb-small-note" id="k9x-rune-status">Status: stopped</div>
            </div>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="heal">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Auto Heal</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-auto-heal-enabled" />
                <span>Enable Auto Heal</span>
              </label>
              <div class="mb-field-grid">
                <label class="mb-field" for="k9x-auto-heal-min-hp">
                  <span class="mb-field-label">Minimum HP</span>
                  <input type="number" id="k9x-auto-heal-min-hp" min="0" placeholder="250" />
                </label>
                <label class="mb-field" for="k9x-auto-heal-hp-hotkey">
                  <span class="mb-field-label">HP Hotkey (1-12)</span>
                  <input type="number" id="k9x-auto-heal-hp-hotkey" min="1" max="12" placeholder="1" />
                </label>
                <label class="mb-field" for="k9x-auto-heal-min-mana">
                  <span class="mb-field-label">Minimum Mana</span>
                  <input type="number" id="k9x-auto-heal-min-mana" min="0" placeholder="150" />
                </label>
                <label class="mb-field" for="k9x-auto-heal-mana-hotkey">
                  <span class="mb-field-label">Mana Hotkey (1-12)</span>
                  <input type="number" id="k9x-auto-heal-mana-hotkey" min="1" max="12" placeholder="2" />
                </label>
              </div>
              <div class="mb-small-note">Checks about twenty times per second. HP is used before mana, and unregistered hotkey presses are retried quickly.</div>
            </div>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="talk">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Talk</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-talk-enabled" />
                <span>Enable Auto Reply</span>
              </label>
              <input type="password" id="k9x-talk-api-key" placeholder="Gemini API key" />
              <textarea id="k9x-talk-prompt" placeholder="Reply style prompt"></textarea>
              <div class="mb-small-note" id="k9x-talk-status">Status: idle</div>
              <div class="mb-small-note">Replies only to the newest unseen message in Default chat.</div>
              <div class="mb-small-note">It will not reply to itself and will not admit it is a bot.</div>
            </div>
          </div>
        </div>
        <div class="mb-talk-column">
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="attack">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Auto Attack</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-auto-attack-enabled" />
                <span>Enable Auto Attack</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-auto-attack-melee" />
                <span>Melee Mode</span>
              </label>
              <label class="mb-field" for="k9x-auto-attack-hotkey">
                <span class="mb-field-label">Target Hotkey (1-12)</span>
                <input type="number" id="k9x-auto-attack-hotkey" min="1" max="12" placeholder="3" />
              </label>
              <label class="mb-field" for="k9x-auto-attack-rune-hotkey">
                <span class="mb-field-label">Rune Hotkey (1-12)</span>
                <input type="number" id="k9x-auto-attack-rune-hotkey" min="1" max="12" placeholder="4" />
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-auto-attack-exori" />
                <span>Exori (knight AOE)</span>
              </label>
              <label class="mb-field" for="k9x-auto-attack-exori-hotkey">
                <span class="mb-field-label">Exori Hotkey (1-12)</span>
                <input type="number" id="k9x-auto-attack-exori-hotkey" min="1" max="12" placeholder="5" />
              </label>
              <label class="mb-field" for="k9x-auto-attack-exori-min">
                <span class="mb-field-label">Exori Min Creatures (1-8)</span>
                <input type="number" id="k9x-auto-attack-exori-min" min="1" max="8" placeholder="3" />
              </label>
              <label class="mb-field" for="k9x-auto-attack-filter-mode">
                <span class="mb-field-label">Target Filter</span>
                <select id="k9x-auto-attack-filter-mode">
                  <option value="all">All monsters</option>
                  <option value="include">Only include list</option>
                  <option value="exclude">Exclude list</option>
                </select>
              </label>
              <div class="mb-inline">
                <input type="text" id="k9x-auto-attack-filter-name" placeholder="Creature name" />
                <button type="button" class="mb-small-button" id="k9x-auto-attack-include-add">Include</button>
              </div>
              <button type="button" class="mb-small-button" id="k9x-auto-attack-exclude-add">Exclude</button>
              <div class="mb-small-note">Include list (used when Target Filter is "Only include list")</div>
              <div class="mb-list" id="k9x-auto-attack-include-list"></div>
              <div class="mb-small-note">Exclude list (used when Target Filter is "Exclude list")</div>
              <div class="mb-list" id="k9x-auto-attack-exclude-list"></div>
              <div class="mb-small-note">Melee mode uses the target hotkey, then walks adjacent to the target. Non-melee mode uses the target hotkey to acquire a target and the rune hotkey to cast on that target. Exori casts when enough face-to-face (adjacent) monsters match the target filter.</div>
            </div>
          </div>
        </div>
        <div class="mb-cave-column">
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="cave">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Cave Bot</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <div class="mb-field-grid">
                <label class="mb-field" for="k9x-cave-preset-select">
                  <select id="k9x-cave-preset-select"></select>
                </label>
              </div>
              <div class="mb-actions mb-actions-inline-two">
                <button type="button" class="mb-small-button" id="k9x-cave-preset-new">New</button>
                <button type="button" class="mb-small-button" id="k9x-cave-preset-delete">Delete</button>
              </div>
              <div class="mb-actions mb-actions-inline-two">
                <button type="button" class="mb-small-button" id="k9x-cave-record">Record Spot</button>
                <button type="button" class="mb-small-button" id="k9x-cave-remove-last">Remove Last</button>
              </div>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-cave-cycle" />
                <span>Cycle route (loop)</span>
              </label>
              <div class="mb-small-note" id="k9x-cave-closest">Closest start: no waypoints</div>
              <div class="mb-small-note" id="k9x-cave-transition-status">Transitions learned: none</div>
              <div class="mb-actions mb-actions-inline-two">
                <button type="button" class="mb-small-button" id="k9x-cave-start">Start</button>
                <button type="button" class="mb-small-button" id="k9x-cave-stop">Stop</button>
              </div>
              <div class="mb-small-note" id="k9x-cave-status">Status: no waypoints</div>
            </div>
          </div>
        </div>
      </div>
      <div class="mb-footer">
        source:
        <a href="https://github.com/pasqualguerrero/k9x" target="_blank" rel="noopener noreferrer">github.com/pasqualguerrero/k9x</a>
      </div>
    `;
    document.body.appendChild(panel);

    const unlockAudio = () => {
      bot.unlockAudio?.();
    };

    panel.addEventListener("pointerdown", unlockAudio, { passive: true });
    panel.addEventListener("keydown", unlockAudio);

    bot.addCleanup(() => {
      panel.removeEventListener("pointerdown", unlockAudio);
      panel.removeEventListener("keydown", unlockAudio);
    });

    applySavedPanelPosition(panel);
    enableDrag(panel);
    setPanelCollapsed(panel, getSavedPanelCollapsed());
    enableCollapsibleSections(panel);

    const spellInput = panel.querySelector("#k9x-rune-spell");
    const runeHotkeyInput = panel.querySelector("#k9x-rune-hotkey");
    const manaInput = panel.querySelector("#k9x-rune-mana");
    const runeMinHpInput = panel.querySelector("#k9x-rune-min-hp");
    const runeMinFoodInput = panel.querySelector("#k9x-rune-min-food");
    const runeCooldownInput = panel.querySelector("#k9x-rune-cooldown");
    const runeEnabledInput = panel.querySelector("#k9x-rune-enabled");
    const autoEatEnabledInput = panel.querySelector("#k9x-auto-eat-enabled");
    const autoEatHotkeyInput = panel.querySelector("#k9x-auto-eat-hotkey");
    const autoFishingEnabledInput = panel.querySelector("#k9x-auto-fishing-enabled");
    const autoInvisibleEnabledInput = panel.querySelector("#k9x-auto-invisible-enabled");
    const autoMagicShieldEnabledInput = panel.querySelector("#k9x-auto-magic-shield-enabled");
    const equipRingEnabledInput = panel.querySelector("#k9x-equip-ring-enabled");
    const autoHealEnabledInput = panel.querySelector("#k9x-auto-heal-enabled");
    const autoHealMinHpInput = panel.querySelector("#k9x-auto-heal-min-hp");
    const autoHealHpHotkeyInput = panel.querySelector("#k9x-auto-heal-hp-hotkey");
    const autoHealMinManaInput = panel.querySelector("#k9x-auto-heal-min-mana");
    const autoHealManaHotkeyInput = panel.querySelector("#k9x-auto-heal-mana-hotkey");
    const autoAttackEnabledInput = panel.querySelector("#k9x-auto-attack-enabled");
    const autoAttackMeleeInput = panel.querySelector("#k9x-auto-attack-melee");
    const autoAttackHotkeyInput = panel.querySelector("#k9x-auto-attack-hotkey");
    const autoAttackRuneHotkeyInput = panel.querySelector("#k9x-auto-attack-rune-hotkey");
    const autoAttackExoriInput = panel.querySelector("#k9x-auto-attack-exori");
    const autoAttackExoriHotkeyInput = panel.querySelector("#k9x-auto-attack-exori-hotkey");
    const autoAttackExoriMinInput = panel.querySelector("#k9x-auto-attack-exori-min");
    const autoAttackFilterModeInput = panel.querySelector("#k9x-auto-attack-filter-mode");
    const autoAttackFilterNameInput = panel.querySelector("#k9x-auto-attack-filter-name");
    const autoAttackIncludeAddButton = panel.querySelector("#k9x-auto-attack-include-add");
    const autoAttackExcludeAddButton = panel.querySelector("#k9x-auto-attack-exclude-add");
    const talkEnabledInput = panel.querySelector("#k9x-talk-enabled");
    const talkApiKeyInput = panel.querySelector("#k9x-talk-api-key");
    const talkPromptInput = panel.querySelector("#k9x-talk-prompt");
    const panicGmNameInput = panel.querySelector("#k9x-panic-gm-input");
    const panicGmAddButton = panel.querySelector("#k9x-panic-gm-add");
    const panicUnknownInput = panel.querySelector("#k9x-panic-unknown");
    const panicHealthInput = panel.querySelector("#k9x-panic-health");
    const panicReturnInput = panel.querySelector("#k9x-panic-return");
    const panicWhisperInput = panel.querySelector("#k9x-panic-whisper");
    const panicTrustedInput = panel.querySelector("#k9x-panic-trusted-input");
    const panicTrustedAddButton = panel.querySelector("#k9x-panic-trusted-add");
    const xrayOverlayButton = panel.querySelector("#k9x-xray-overlay-toggle");
    const xrayFloorSelect = panel.querySelector("#k9x-xray-floor-select");
    const collapseButton = panel.querySelector("#k9x-collapse");
    const reloadButton = panel.querySelector("#k9x-reload");
    const caveRecordButton = panel.querySelector("#k9x-cave-record");
    const caveRemoveLastButton = panel.querySelector("#k9x-cave-remove-last");
    const caveStartButton = panel.querySelector("#k9x-cave-start");
    const caveStopButton = panel.querySelector("#k9x-cave-stop");
    const caveCycleToggle = panel.querySelector("#k9x-cave-cycle");
    const cavePresetSelect = panel.querySelector("#k9x-cave-preset-select");
    const cavePresetNewButton = panel.querySelector("#k9x-cave-preset-new");
    const cavePresetDeleteButton = panel.querySelector("#k9x-cave-preset-delete");

    if (collapseButton) {
      collapseButton.addEventListener("click", () => {
        const isCollapsed = panel.dataset.collapsed === "true";
        setPanelCollapsed(panel, !isCollapsed);
      });
    }

    if (reloadButton) {
      reloadButton.addEventListener("click", () => {
        window.minibiaBotReload?.();
      });
    }

    function addTrustedName() {
      const rawName = panicTrustedInput?.value?.trim() || "";
      if (!rawName) {
        return;
      }

      const currentNames = bot.panic?.config?.trustedNames || [];
      const exists = currentNames.some(
        (name) => String(name).trim().toLowerCase() === rawName.toLowerCase()
      );

      if (!exists) {
        bot.panic.updateConfig({ trustedNames: [...currentNames, rawName] });
      }

      if (panicTrustedInput) {
        panicTrustedInput.value = "";
      }

      renderTrustedNames();
    }

    function addGameMasterName() {
      const rawName = panicGmNameInput?.value?.trim() || "";
      if (!rawName) {
        return;
      }

      const currentNames = bot.panic?.config?.gameMasterNames || [];
      const exists = currentNames.some(
        (name) => String(name).trim().toLowerCase() === rawName.toLowerCase()
      );

      if (!exists) {
        bot.panic.updateConfig({ gameMasterNames: [...currentNames, rawName] });
      }

      if (panicGmNameInput) {
        panicGmNameInput.value = "";
      }

      renderGameMasterNames();
    }

    if (panicGmAddButton) {
      panicGmAddButton.addEventListener("click", addGameMasterName);
    }

    if (panicGmNameInput) {
      panicGmNameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addGameMasterName();
        }
      });
    }

    if (panicTrustedAddButton) {
      panicTrustedAddButton.addEventListener("click", addTrustedName);
    }

    if (panicTrustedInput) {
      panicTrustedInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addTrustedName();
        }
      });
    }

    function readRuneHotbarSlotFromInput() {
      const rawValue = Number(runeHotkeyInput?.value);
      return Number.isFinite(rawValue) && rawValue >= 1 && rawValue <= 12
        ? Math.trunc(rawValue)
        : null;
    }

    function readRuneConfigFromInputs() {
      const runeSpellWords = spellInput?.value?.trim() || bot.rune?.config?.runeSpellWords || "";
      const runeHotbarSlot = readRuneHotbarSlotFromInput() ?? bot.rune?.config?.runeHotbarSlot ?? null;
      const runeManaCost = Math.max(0, Number(manaInput?.value) || bot.rune?.config?.runeManaCost || 0);
      const minHpPercent = Math.min(
        100,
        Math.max(0, Number(runeMinHpInput?.value) ?? bot.rune?.config?.minHpPercent ?? 50)
      );
      const minFoodSeconds = Math.max(
        0,
        Number(runeMinFoodInput?.value) ?? bot.rune?.config?.minFoodSeconds ?? 30
      );
      const runeCooldownMs = Math.max(
        0,
        Number(runeCooldownInput?.value) ?? bot.rune?.config?.runeCooldownMs ?? 3500
      );

      return {
        runeSpellWords,
        runeHotbarSlot,
        runeManaCost,
        minHpPercent,
        minFoodSeconds,
        runeCooldownMs,
      };
    }

    if (spellInput) {
      spellInput.value = bot.rune?.config?.runeSpellWords || "";
      spellInput.addEventListener("change", () => {
        bot.rune.updateConfig({ runeSpellWords: spellInput.value.trim() });
      });
    }

    if (runeHotkeyInput) {
      runeHotkeyInput.value = bot.rune?.config?.runeHotbarSlot
        ? String(bot.rune.config.runeHotbarSlot)
        : "";
      runeHotkeyInput.addEventListener("change", () => {
        const runeHotbarSlot = readRuneHotbarSlotFromInput();
        runeHotkeyInput.value = runeHotbarSlot ? String(runeHotbarSlot) : "";
        bot.rune.updateConfig({ runeHotbarSlot });
      });
    }

    if (manaInput) {
      manaInput.value = String(bot.rune?.config?.runeManaCost ?? 0);
      manaInput.addEventListener("change", () => {
        const runeManaCost = Math.max(0, Number(manaInput.value) || 0);
        manaInput.value = String(runeManaCost);
        bot.rune.updateConfig({ runeManaCost });
      });
    }

    if (runeMinHpInput) {
      runeMinHpInput.value = String(bot.rune?.config?.minHpPercent ?? 50);
      runeMinHpInput.addEventListener("change", () => {
        const minHpPercent = Math.min(100, Math.max(0, Number(runeMinHpInput.value) || 0));
        runeMinHpInput.value = String(minHpPercent);
        bot.rune.updateConfig({ minHpPercent });
      });
    }

    if (runeMinFoodInput) {
      runeMinFoodInput.value = String(bot.rune?.config?.minFoodSeconds ?? 30);
      runeMinFoodInput.addEventListener("change", () => {
        const minFoodSeconds = Math.max(0, Number(runeMinFoodInput.value) || 0);
        runeMinFoodInput.value = String(minFoodSeconds);
        bot.rune.updateConfig({ minFoodSeconds });
      });
    }

    if (runeCooldownInput) {
      runeCooldownInput.value = String(bot.rune?.config?.runeCooldownMs ?? 3500);
      runeCooldownInput.addEventListener("change", () => {
        const runeCooldownMs = Math.max(0, Number(runeCooldownInput.value) || 0);
        runeCooldownInput.value = String(runeCooldownMs);
        bot.rune.updateConfig({ runeCooldownMs });
      });
    }

    if (runeEnabledInput) {
      runeEnabledInput.checked = !!bot.rune?.status?.().running;
      runeEnabledInput.addEventListener("change", () => {
        if (runeEnabledInput.checked) {
          bot.rune.start(readRuneConfigFromInputs());
        } else {
          bot.rune.stop();
        }

        refreshRuneStatus();
      });
    }

    if (autoEatHotkeyInput) {
      autoEatHotkeyInput.value = String(bot.eat?.config?.eatHotbarSlot ?? 10);
      autoEatHotkeyInput.addEventListener("change", () => {
        const eatHotbarSlot = Math.min(12, Math.max(1, Number(autoEatHotkeyInput.value) || 1));
        autoEatHotkeyInput.value = String(eatHotbarSlot);
        bot.eat.updateConfig({ eatHotbarSlot });
      });
    }

    if (autoEatEnabledInput) {
      autoEatEnabledInput.checked = !!bot.eat?.status?.().running;
      autoEatEnabledInput.addEventListener("change", () => {
        const eatHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoEatHotkeyInput?.value) || bot.eat.config.eatHotbarSlot || 1)
        );

        if (autoEatEnabledInput.checked) {
          bot.eat.start({ eatHotbarSlot });
        } else {
          bot.eat.stop();
        }

        refreshAutoEatStatus();
      });
    }

    if (autoFishingEnabledInput) {
      autoFishingEnabledInput.checked = !!bot.fishing?.status?.().running;
      autoFishingEnabledInput.addEventListener("change", () => {
        if (autoFishingEnabledInput.checked) {
          const started = bot.fishing.start({ promptHotbarSlot: true });
          if (!started) {
            autoFishingEnabledInput.checked = false;
          }
        } else {
          bot.fishing.stop();
        }

        refreshAutoFishingStatus();
      });
    }

    if (autoInvisibleEnabledInput) {
      autoInvisibleEnabledInput.checked = !!bot.invisible?.status?.().running;
      autoInvisibleEnabledInput.addEventListener("change", () => {
        if (autoInvisibleEnabledInput.checked) {
          bot.invisible.start();
        } else {
          bot.invisible.stop();
        }

        refreshAutoInvisibleStatus();
      });
    }

    if (autoMagicShieldEnabledInput) {
      autoMagicShieldEnabledInput.checked = !!bot.magicShield?.status?.().running;
      autoMagicShieldEnabledInput.addEventListener("change", () => {
        if (autoMagicShieldEnabledInput.checked) {
          bot.magicShield.start();
        } else {
          bot.magicShield.stop();
        }

        refreshAutoMagicShieldStatus();
      });
    }

    if (equipRingEnabledInput) {
      equipRingEnabledInput.checked = !!bot.equipRing?.status?.().running;
      equipRingEnabledInput.addEventListener("change", () => {
        if (equipRingEnabledInput.checked) {
          bot.equipRing.start();
        } else {
          bot.equipRing.stop();
        }

        refreshEquipRingStatus();
      });
    }

    if (caveRecordButton) {
      caveRecordButton.addEventListener("click", () => {
        bot.cave.addWaypointCurrentSpot();
        refreshCavePresetControls();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveRemoveLastButton) {
      caveRemoveLastButton.addEventListener("click", () => {
        bot.cave.removeLastWaypoint();
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveStartButton) {
      caveStartButton.addEventListener("click", () => {
        bot.cave.start();
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveStopButton) {
      caveStopButton.addEventListener("click", () => {
        bot.cave.stop();
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveCycleToggle) {
      caveCycleToggle.checked = !!bot.cave?.status?.()?.config?.cycleWaypoints;
      caveCycleToggle.addEventListener("change", () => {
        bot.cave.updateConfig({ cycleWaypoints: caveCycleToggle.checked });
        refreshCaveModeStatus();
      });
    }

    if (cavePresetSelect) {
      cavePresetSelect.addEventListener("change", () => {
        const name = cavePresetSelect.value || "";
        const activePresetName = bot.cave?.getActivePresetName?.() || "";
        if (!name || name === activePresetName) {
          refreshCavePresetControls();
          return;
        }

        const loadedPreset = bot.cave.loadPreset(name);
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (cavePresetNewButton) {
      cavePresetNewButton.addEventListener("click", () => {
        const name = window.prompt("Name the new cave preset:");
        if (name == null) {
          return;
        }

        const createdPreset = bot.cave.createPreset(name);
        if (!createdPreset) {
          return;
        }

        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (cavePresetDeleteButton) {
      cavePresetDeleteButton.addEventListener("click", () => {
        const name = cavePresetSelect?.value || "";
        if (!name) {
          return;
        }

        const deleted = bot.cave.deletePreset(name);
        if (!deleted) {
          return;
        }

        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (autoHealMinHpInput) {
      autoHealMinHpInput.value = String(bot.heal?.config?.minHp ?? 0);
      autoHealMinHpInput.addEventListener("change", () => {
        const minHp = Math.max(0, Number(autoHealMinHpInput.value) || 0);
        autoHealMinHpInput.value = String(minHp);
        bot.heal.updateConfig({ minHp });
      });
    }

    if (autoHealHpHotkeyInput) {
      autoHealHpHotkeyInput.value = String(bot.heal?.config?.hpHotbarSlot ?? 1);
      autoHealHpHotkeyInput.addEventListener("change", () => {
        const hpHotbarSlot = Math.min(12, Math.max(1, Number(autoHealHpHotkeyInput.value) || 1));
        autoHealHpHotkeyInput.value = String(hpHotbarSlot);
        bot.heal.updateConfig({ hpHotbarSlot });
      });
    }

    if (autoHealMinManaInput) {
      autoHealMinManaInput.value = String(bot.heal?.config?.minMana ?? 0);
      autoHealMinManaInput.addEventListener("change", () => {
        const minMana = Math.max(0, Number(autoHealMinManaInput.value) || 0);
        autoHealMinManaInput.value = String(minMana);
        bot.heal.updateConfig({ minMana });
      });
    }

    if (autoHealManaHotkeyInput) {
      autoHealManaHotkeyInput.value = String(bot.heal?.config?.manaHotbarSlot ?? 1);
      autoHealManaHotkeyInput.addEventListener("change", () => {
        const manaHotbarSlot = Math.min(12, Math.max(1, Number(autoHealManaHotkeyInput.value) || 1));
        autoHealManaHotkeyInput.value = String(manaHotbarSlot);
        bot.heal.updateConfig({ manaHotbarSlot });
      });
    }

    if (autoHealEnabledInput) {
      autoHealEnabledInput.checked = !!bot.heal?.status?.().running;
      autoHealEnabledInput.addEventListener("change", () => {
        const minHp = Math.max(0, Number(autoHealMinHpInput?.value) || bot.heal.config.minHp || 0);
        const hpHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoHealHpHotkeyInput?.value) || bot.heal.config.hpHotbarSlot || 1)
        );
        const minMana = Math.max(0, Number(autoHealMinManaInput?.value) || bot.heal.config.minMana || 0);
        const manaHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoHealManaHotkeyInput?.value) || bot.heal.config.manaHotbarSlot || 1)
        );

        if (autoHealEnabledInput.checked) {
          bot.heal.start({ minHp, hpHotbarSlot, minMana, manaHotbarSlot });
        } else {
          bot.heal.stop();
        }

        refreshAutoHealStatus();
      });
    }

    if (autoAttackHotkeyInput) {
      autoAttackHotkeyInput.value = String(bot.attack?.config?.targetHotbarSlot ?? 3);
      autoAttackHotkeyInput.addEventListener("change", () => {
        const targetHotbarSlot = Math.min(12, Math.max(1, Number(autoAttackHotkeyInput.value) || 1));
        autoAttackHotkeyInput.value = String(targetHotbarSlot);
        bot.attack.updateConfig({ targetHotbarSlot });
      });
    }

    if (autoAttackRuneHotkeyInput) {
      autoAttackRuneHotkeyInput.value = bot.attack?.config?.runeHotbarSlot
        ? String(bot.attack.config.runeHotbarSlot)
        : "";
      autoAttackRuneHotkeyInput.addEventListener("change", () => {
        const rawValue = Number(autoAttackRuneHotkeyInput.value);
        const runeHotbarSlot = Number.isFinite(rawValue) && rawValue >= 1 && rawValue <= 12
          ? Math.trunc(rawValue)
          : null;
        autoAttackRuneHotkeyInput.value = runeHotbarSlot ? String(runeHotbarSlot) : "";
        bot.attack.updateConfig({ runeHotbarSlot });
      });
    }

    if (autoAttackMeleeInput) {
      autoAttackMeleeInput.checked = bot.attack?.config?.meleeMode !== false;
      autoAttackMeleeInput.addEventListener("change", () => {
        bot.attack.updateConfig({ meleeMode: autoAttackMeleeInput.checked });
      });
    }

    if (autoAttackExoriInput) {
      autoAttackExoriInput.checked = !!bot.attack?.config?.exoriEnabled;
      autoAttackExoriInput.addEventListener("change", () => {
        bot.attack.updateConfig({ exoriEnabled: autoAttackExoriInput.checked });
      });
    }

    if (autoAttackExoriHotkeyInput) {
      autoAttackExoriHotkeyInput.value = bot.attack?.config?.exoriHotbarSlot
        ? String(bot.attack.config.exoriHotbarSlot)
        : "";
      autoAttackExoriHotkeyInput.addEventListener("change", () => {
        const rawValue = Number(autoAttackExoriHotkeyInput.value);
        const exoriHotbarSlot = Number.isFinite(rawValue) && rawValue >= 1 && rawValue <= 12
          ? Math.trunc(rawValue)
          : null;
        autoAttackExoriHotkeyInput.value = exoriHotbarSlot ? String(exoriHotbarSlot) : "";
        bot.attack.updateConfig({ exoriHotbarSlot });
      });
    }

    if (autoAttackExoriMinInput) {
      autoAttackExoriMinInput.value = String(bot.attack?.config?.exoriMinCreatures ?? 3);
      autoAttackExoriMinInput.addEventListener("change", () => {
        const exoriMinCreatures = Math.min(
          8,
          Math.max(1, Math.trunc(Number(autoAttackExoriMinInput.value) || 3))
        );
        autoAttackExoriMinInput.value = String(exoriMinCreatures);
        bot.attack.updateConfig({ exoriMinCreatures });
      });
    }

    function addNameToAutoAttackList(listKey) {
      const rawName = autoAttackFilterNameInput?.value?.trim() || "";
      if (!rawName) {
        return;
      }

      const config = bot.attack?.config || {};
      const currentList = Array.isArray(config[listKey]) ? config[listKey] : [];
      const exists = currentList.some(
        (name) => String(name).trim().toLowerCase() === rawName.toLowerCase()
      );

      if (!exists) {
        bot.attack.updateConfig({ [listKey]: [...currentList, rawName] });
      }

      if (autoAttackFilterNameInput) {
        autoAttackFilterNameInput.value = "";
      }

      refreshAutoAttackFilterControls();
    }

    if (autoAttackFilterModeInput) {
      autoAttackFilterModeInput.value = bot.attack?.config?.targetFilterMode || "all";
      autoAttackFilterModeInput.addEventListener("change", () => {
        const mode = autoAttackFilterModeInput.value;
        bot.attack.updateConfig({ targetFilterMode: mode });
        refreshAutoAttackFilterControls();
      });
    }

    if (autoAttackIncludeAddButton) {
      autoAttackIncludeAddButton.addEventListener("click", () => {
        addNameToAutoAttackList("includedCreatureNames");
      });
    }

    if (autoAttackExcludeAddButton) {
      autoAttackExcludeAddButton.addEventListener("click", () => {
        addNameToAutoAttackList("excludedCreatureNames");
      });
    }

    if (autoAttackFilterNameInput) {
      autoAttackFilterNameInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        const mode = autoAttackFilterModeInput?.value === "exclude"
          ? "excludedCreatureNames"
          : "includedCreatureNames";
        addNameToAutoAttackList(mode);
      });
    }

    if (autoAttackEnabledInput) {
      autoAttackEnabledInput.checked = !!bot.attack?.status?.().running;
      autoAttackEnabledInput.addEventListener("change", () => {
        const targetHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoAttackHotkeyInput?.value) || bot.attack.config.targetHotbarSlot || 1)
        );
        const runeHotbarSlot = (() => {
          const rawValue = Number(autoAttackRuneHotkeyInput?.value);
          if (Number.isFinite(rawValue) && rawValue >= 1 && rawValue <= 12) {
            return Math.trunc(rawValue);
          }

          return bot.attack.config.runeHotbarSlot ?? null;
        })();
        const exoriHotbarSlot = (() => {
          const rawValue = Number(autoAttackExoriHotkeyInput?.value);
          if (Number.isFinite(rawValue) && rawValue >= 1 && rawValue <= 12) {
            return Math.trunc(rawValue);
          }

          return bot.attack.config.exoriHotbarSlot ?? null;
        })();
        const exoriMinCreatures = Math.min(
          8,
          Math.max(1, Math.trunc(Number(autoAttackExoriMinInput?.value) || bot.attack.config.exoriMinCreatures || 3))
        );
        const meleeMode = !!autoAttackMeleeInput?.checked;
        const exoriEnabled = !!autoAttackExoriInput?.checked;

        if (autoAttackEnabledInput.checked) {
          bot.attack.start({
            targetHotbarSlot,
            runeHotbarSlot,
            meleeMode,
            exoriEnabled,
            exoriHotbarSlot,
            exoriMinCreatures,
          });
        } else {
          bot.attack.stop();
        }

        refreshAutoAttackStatus();
      });
    }

    if (talkApiKeyInput) {
      talkApiKeyInput.value = bot.talk?.config?.apiKey || "";
      talkApiKeyInput.addEventListener("change", () => {
        bot.talk.updateConfig({ apiKey: talkApiKeyInput.value.trim() });
        refreshTalkStatus();
      });
    }

    if (talkPromptInput) {
      talkPromptInput.value = bot.talk?.config?.systemPrompt || "";
      talkPromptInput.addEventListener("change", () => {
        bot.talk.updateConfig({ systemPrompt: talkPromptInput.value.trim() });
      });
    }

    if (talkEnabledInput) {
      talkEnabledInput.checked = !!bot.talk?.status?.().running;
      talkEnabledInput.addEventListener("change", () => {
        if (talkEnabledInput.checked) {
          bot.talk.updateConfig({
            apiKey: talkApiKeyInput?.value?.trim() || "",
            systemPrompt: talkPromptInput?.value?.trim() || bot.talk.config.systemPrompt || "",
          });
          const started = bot.talk.start();
          if (!started) {
            talkEnabledInput.checked = false;
          }
        } else {
          bot.talk.stop();
        }

        refreshTalkStatus();
      });
    }

    if (panicUnknownInput) {
      panicUnknownInput.checked = !!bot.panic?.status?.().config?.unknownPlayerEnabled;
      panicUnknownInput.addEventListener("change", () => {
        bot.panic.updateConfig({ unknownPlayerEnabled: panicUnknownInput.checked });
        refreshPanicStatus();
      });
    }

    if (panicHealthInput) {
      panicHealthInput.checked = !!bot.panic?.status?.().config?.healthLossEnabled;
      panicHealthInput.addEventListener("change", () => {
        bot.panic.updateConfig({ healthLossEnabled: panicHealthInput.checked });
        refreshPanicStatus();
      });
    }

    if (panicReturnInput) {
      panicReturnInput.checked = !!bot.panic?.status?.().config?.returnToOriginEnabled;
      panicReturnInput.addEventListener("change", () => {
        bot.panic.updateConfig({ returnToOriginEnabled: panicReturnInput.checked });
        refreshPanicStatus();
      });
    }

    if (panicWhisperInput) {
      panicWhisperInput.checked = !!bot.panic?.status?.().config?.whisperAlarmEnabled;
      panicWhisperInput.addEventListener("change", () => {
        bot.panic.updateConfig({ whisperAlarmEnabled: panicWhisperInput.checked });
        refreshPanicStatus();
      });
    }

    if (xrayOverlayButton) {
      xrayOverlayButton.addEventListener("click", () => {
        const enabled = !!bot.xray?.status?.().config?.overlayEnabled;
        bot.xray?.setOverlayEnabled?.(!enabled);
        refreshXrayStatus();
      });
    }

    if (xrayFloorSelect) {
      xrayFloorSelect.addEventListener("change", () => {
        const rawValue = xrayFloorSelect.value;
        bot.xray?.setSelectedFloor?.(rawValue === "all" ? null : Number(rawValue));
        refreshXrayStatus();
        refreshVisibleCreatures();
      });
    }

    panel.querySelector("#k9x-set-home")?.addEventListener("click", () => {
      bot.pz.setHomePzCurrentSpot();
      refreshHomeLabel();
    });

    refreshHomeLabel();
    refreshPanicStatus();
    refreshXrayStatus();
    renderGameMasterNames();
    renderTrustedNames();
    refreshRuneStatus();
    refreshAutoHealStatus();
    refreshAutoInvisibleStatus();
    refreshAutoMagicShieldStatus();
    refreshAutoAttackStatus();
    refreshAutoAttackFilterControls();
    refreshAutoEatStatus();
    refreshAutoFishingStatus();
    refreshCaveStatus();
    refreshCaveModeStatus();
    refreshEquipRingStatus();
    refreshTalkStatus();
    refreshVisibleCreatures();
    refreshCavePresetControls();
    refreshCaveClosestStatus();
    refreshCaveTransitionStatus();

    const autoAttackFilterTimerId = window.setInterval(refreshAutoAttackFilterControls, 1000);
    bot.addCleanup(() => {
      window.clearInterval(autoAttackFilterTimerId);
    });

    const visibleCreaturesTimerId = window.setInterval(refreshVisibleCreatures, 1000);
    bot.addCleanup(() => {
      window.clearInterval(visibleCreaturesTimerId);
    });

    const talkStatusTimerId = window.setInterval(refreshTalkStatus, 1000);
    bot.addCleanup(() => {
      window.clearInterval(talkStatusTimerId);
    });

    const autoFishingStatusTimerId = window.setInterval(refreshAutoFishingStatus, 1000);
    bot.addCleanup(() => {
      window.clearInterval(autoFishingStatusTimerId);
    });

    const runeStatusTimerId = window.setInterval(refreshRuneStatus, 1000);
    bot.addCleanup(() => {
      window.clearInterval(runeStatusTimerId);
    });

    const caveStatusTimerId = window.setInterval(() => {
      refreshCaveStatus();
      refreshCaveModeStatus();
      refreshCavePresetControls();
      refreshCaveClosestStatus();
      refreshCaveTransitionStatus();
    }, 1000);
    bot.addCleanup(() => {
      window.clearInterval(caveStatusTimerId);
    });

  }

  bot.ui = {
    inject,
    destroy,
    refreshHomeLabel,
    refreshPanicStatus,
    refreshXrayStatus,
    refreshRuneStatus,
    refreshAutoHealStatus,
    refreshAutoInvisibleStatus,
    refreshAutoMagicShieldStatus,
    refreshAutoAttackStatus,
    refreshAutoAttackFilterControls,
    refreshAutoEatStatus,
    refreshAutoFishingStatus,
    refreshCaveStatus,
    refreshCaveModeStatus,
    refreshCavePresetControls,
    refreshEquipRingStatus,
    refreshTalkStatus,
    refreshVisibleCreatures,
    refreshCaveClosestStatus,
    refreshCaveTransitionStatus,
    getSavedPanelPosition,
    getSavedPanelCollapsed,
    setPanelCollapsed: (collapsed) => {
      const panel = document.getElementById("k9x-panel");
      setPanelCollapsed(panel, collapsed);
    },
  };
};
