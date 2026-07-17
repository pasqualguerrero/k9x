#!/usr/bin/env bash
set -euo pipefail

cat \
  src/core.js \
  src/modules/pz.js \
  src/modules/xray.js \
  src/modules/panic.js \
  src/modules/rune.js \
  src/modules/heal.js \
  src/modules/auto-invisible.js \
  src/modules/auto-magic-shield.js \
  src/modules/force-light.js \
  src/modules/auto-attack.js \
  src/modules/cave.js \
  src/modules/equip-ring.js \
  src/modules/auto-eat.js \
  src/modules/auto-fishing.js \
  src/modules/talk.js \
  src/ui/panel.js \
  src/main.js \
  > pz-bot.js
