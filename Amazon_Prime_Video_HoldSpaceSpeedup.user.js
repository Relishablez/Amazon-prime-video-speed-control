// ==UserScript==
// @name         Amazon Prime Video — Hold Space to Speed Up
// @namespace    apv-speed
// @version      10.0
// @match        https://www.amazon.co.uk/*
// @match        https://www.amazon.com/*
// @match        https://www.primevideo.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    holdDelayMs: 300,
    controlsHideDelayMs: 1000,
    pollMs: 1000,
    defaultBoostRate: 2,
    dragMargin: 8,
    uiTop: 18,
    uiRight: 18
  };

  const SELECTORS = {
    player: '.atvwebplayersdk-player-container',
    video: '.atvwebplayersdk-player-container video, video',

    topControls: '.atvwebplayersdk-hideabletopbuttons-container',
    bottomPanel: '.atvwebplayersdk-bottompanel-container',
    centerPlayPause: '.atvwebplayersdk-playpause-button',
    centerBack: '.atvwebplayersdk-fastseekback-button',
    centerForward: '.atvwebplayersdk-fastseekforward-button',
    seekbar: '.atvwebplayersdk-seekbar-container',
    infoBar: '.atvwebplayersdk-infobar-container',
    title: '.atvwebplayersdk-title-text',
    subtitle: '.atvwebplayersdk-subtitle-text'
  };

  const state = {
    boostRate: CONFIG.defaultBoostRate,
    restoreRate: 1,
    holdTimer: null,
    hideTimer: null,
    pollTimer: null,
    currentVideo: null,

    isBoosting: false,
    isSpaceDown: false,
    didBoostThisPress: false,

    controlsLockedVisible: false,
    controlsTemporarilyVisible: false,

    collapsed: false,
    drag: null
  };

  function getPlayer() {
    return document.querySelector(SELECTORS.player);
  }

  function getVideo() {
    return document.querySelector(SELECTORS.video);
  }

  function isPaused() {
    const video = getVideo();
    return !video || video.paused || video.ended;
  }

  function isPlaying() {
    const video = getVideo();
    return !!(video && !video.paused && !video.ended);
  }

  function formatRate(rate) {
    if (!Number.isFinite(rate)) return '—';
    if (Math.abs(rate - Math.round(rate)) < 0.001) return `${Math.round(rate)}x`;
    return `${rate.toFixed(2).replace(/0$/, '').replace(/\.$/, '')}x`;
  }

  function isEditable(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  }

  function inOurUi(el) {
    return !!(el instanceof Element && el.closest('[data-apv-speed-ui]'));
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      [data-apv-speed-ui] {
        position: fixed;
        top: ${CONFIG.uiTop}px;
        right: ${CONFIG.uiRight}px;
        left: auto;
        bottom: auto;
        z-index: 2147483646;
        pointer-events: none;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: #f3fff6;
      }

      [data-apv-speed-ui] * {
        box-sizing: border-box;
      }

      [data-apv-speed-ui] .apv-panel,
      [data-apv-speed-ui] .apv-pill {
        pointer-events: auto;
        user-select: none;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        background: rgba(10, 14, 11, 0.72);
        border: 1px solid rgba(140, 255, 175, 0.14);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
        transition: opacity 140ms ease, transform 140ms ease;
      }

      [data-apv-speed-ui] .apv-panel {
        width: 248px;
        max-width: calc(100vw - 16px);
        border-radius: 14px;
        padding: 10px;
      }

      [data-apv-speed-ui] .apv-pill {
        display: none;
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }

      [data-apv-speed-ui].is-collapsed .apv-panel {
        display: none;
      }

      [data-apv-speed-ui].is-collapsed .apv-pill {
        display: inline-flex;
        align-items: center;
      }

      [data-apv-speed-ui].is-playing .apv-panel,
      [data-apv-speed-ui].is-playing .apv-pill {
        opacity: 0.18;
      }

      [data-apv-speed-ui]:hover .apv-panel,
      [data-apv-speed-ui]:hover .apv-pill {
        opacity: 0.95 !important;
      }

      [data-apv-speed-ui] .apv-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        cursor: move;
      }

      [data-apv-speed-ui] .apv-title {
        font-size: 13px;
        font-weight: 700;
        line-height: 1.15;
      }

      [data-apv-speed-ui] .apv-subtitle {
        margin-top: 2px;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(220,235,225,0.58);
      }

      [data-apv-speed-ui] .apv-head-right {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      [data-apv-speed-ui] .apv-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        background: rgba(120,255,160,0.08);
        border: 1px solid rgba(120,255,160,0.12);
        white-space: nowrap;
      }

      [data-apv-speed-ui] .apv-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #7dffab;
        box-shadow: 0 0 8px rgba(125,255,171,0.38);
      }

      [data-apv-speed-ui] .apv-collapse {
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 7px;
        background: rgba(255,255,255,0.06);
        color: #fff;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
      }

      [data-apv-speed-ui] .apv-body {
        margin-top: 8px;
      }

      [data-apv-speed-ui] .apv-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
      }

      [data-apv-speed-ui] .apv-btn {
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 9px;
        background: rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.86);
        padding: 9px 0;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }

      [data-apv-speed-ui] .apv-btn.is-active {
        background: rgba(120,255,160,0.85);
        color: #082112;
        border-color: rgba(200,255,215,0.75);
        font-weight: 800;
      }

      [data-apv-speed-ui] .apv-row {
        margin-top: 8px;
        padding: 8px 10px;
        display: flex;
        justify-content: space-between;
        gap: 8px;
        border-radius: 10px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.07);
        font-size: 12px;
      }

      [data-apv-speed-ui] .apv-help {
        margin-top: 8px;
        text-align: center;
        font-size: 10px;
        color: rgba(220,235,225,0.48);
      }

      [data-apv-speed-ui] .apv-waiting {
        margin-top: 8px;
        padding: 10px;
        border-radius: 10px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.07);
        text-align: center;
        font-size: 12px;
        color: rgba(240,255,245,0.76);
      }

      ${SELECTORS.player}[data-apv-controls-mode="hidden"] ${SELECTORS.topControls},
      ${SELECTORS.player}[data-apv-controls-mode="hidden"] ${SELECTORS.bottomPanel},
      ${SELECTORS.player}[data-apv-controls-mode="hidden"] ${SELECTORS.centerPlayPause},
      ${SELECTORS.player}[data-apv-controls-mode="hidden"] ${SELECTORS.centerBack},
      ${SELECTORS.player}[data-apv-controls-mode="hidden"] ${SELECTORS.centerForward} {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transition: opacity 80ms linear !important;
      }

      ${SELECTORS.player}[data-apv-controls-mode="hidden"] ${SELECTORS.seekbar},
      ${SELECTORS.player}[data-apv-controls-mode="hidden"] ${SELECTORS.infoBar},
      ${SELECTORS.player}[data-apv-controls-mode="hidden"] ${SELECTORS.title},
      ${SELECTORS.player}[data-apv-controls-mode="hidden"] ${SELECTORS.subtitle} {
        opacity: 0 !important;
        visibility: hidden !important;
        transition: opacity 80ms linear !important;
      }
    `;
    document.head.appendChild(style);
  }

  function buildUI() {
    const root = document.createElement('div');
    root.setAttribute('data-apv-speed-ui', '1');

    const panel = document.createElement('div');
    panel.className = 'apv-panel';

    const header = document.createElement('div');
    header.className = 'apv-header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'apv-title';
    title.textContent = 'Playback speed';

    const subtitle = document.createElement('div');
    subtitle.className = 'apv-subtitle';
    subtitle.textContent = 'Hold Space to boost';

    titleWrap.append(title, subtitle);

    const headerRight = document.createElement('div');
    headerRight.className = 'apv-head-right';

    const badge = document.createElement('div');
    badge.className = 'apv-badge';

    const dot = document.createElement('span');
    dot.className = 'apv-dot';

    const badgeText = document.createElement('span');
    badge.append(dot, badgeText);

    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'apv-collapse';
    collapse.textContent = '–';

    headerRight.append(badge, collapse);
    header.append(titleWrap, headerRight);

    const body = document.createElement('div');
    body.className = 'apv-body';

    const waiting = document.createElement('div');
    waiting.className = 'apv-waiting';
    waiting.textContent = 'Waiting for video playback…';

    const grid = document.createElement('div');
    grid.className = 'apv-grid';

    const presetButtons = [1.5, 2, 2.5, 3].map((rate) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'apv-btn';
      b.textContent = `${rate}x`;
      b.addEventListener('click', () => {
        state.boostRate = rate;
        renderUI();
      });
      grid.appendChild(b);
      return { rate, button: b };
    });

    const currentRow = document.createElement('div');
    currentRow.className = 'apv-row';

    const currentLabel = document.createElement('span');
    currentLabel.textContent = 'Current video rate';

    const currentValue = document.createElement('span');
    currentValue.style.fontWeight = '800';

    currentRow.append(currentLabel, currentValue);

    const help = document.createElement('div');
    help.className = 'apv-help';
    help.textContent = 'Tap Space = play/pause • Hold Space = temporary boost';

    body.append(waiting, grid, currentRow, help);
    panel.append(header, body);

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'apv-pill';

    collapse.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.collapsed = !state.collapsed;
      renderUI();
    });

    pill.addEventListener('click', () => {
      state.collapsed = false;
      renderUI();
    });

    root.append(panel, pill);
    document.documentElement.appendChild(root);

    return {
      root,
      panel,
      pill,
      header,
      badgeText,
      collapse,
      waiting,
      grid,
      currentRow,
      currentValue,
      presetButtons
    };
  }

  injectStyles();
  const ui = buildUI();

  function renderUI() {
    const video = getVideo();
    const playing = !!(video && !video.paused && !video.ended);

    ui.root.classList.toggle('is-playing', playing);
    ui.root.classList.toggle('is-collapsed', state.collapsed);

    ui.badgeText.textContent = video ? formatRate(state.boostRate) : 'Waiting';
    ui.pill.textContent = video ? `Playback ${formatRate(state.boostRate)}` : 'Waiting for player…';
    ui.currentValue.textContent = video ? formatRate(video.playbackRate) : '—';

    ui.waiting.style.display = video ? 'none' : 'block';
    ui.grid.style.display = video ? 'grid' : 'none';
    ui.currentRow.style.display = video ? 'flex' : 'none';

    ui.collapse.textContent = state.collapsed ? '+' : '–';
    ui.collapse.setAttribute('aria-label', state.collapsed ? 'Expand panel' : 'Collapse panel');

    ui.presetButtons.forEach(({ rate, button }) => {
      button.classList.toggle('is-active', rate === state.boostRate);
    });
  }

  function setControlsVisible() {
    const player = getPlayer();
    if (!player) return;
    player.setAttribute('data-apv-controls-mode', 'visible');
  }

  function setControlsHidden() {
    const player = getPlayer();
    if (!player) return;
    player.setAttribute('data-apv-controls-mode', 'hidden');
  }

  function clearHideTimer() {
    clearTimeout(state.hideTimer);
    state.hideTimer = null;
  }

  function scheduleControlsHide() {
    clearHideTimer();

    if (!isPlaying()) {
      setControlsVisible();
      return;
    }

    state.hideTimer = window.setTimeout(() => {
      if (!isPlaying()) {
        setControlsVisible();
        return;
      }
      if (state.controlsLockedVisible) {
        setControlsVisible();
        return;
      }
      setControlsHidden();
    }, CONFIG.controlsHideDelayMs);
  }

  function showControlsNow() {
    setControlsVisible();
    state.controlsTemporarilyVisible = true;
    scheduleControlsHide();
  }

  function syncControlsState() {
    if (isPaused()) {
      state.controlsLockedVisible = true;
      setControlsVisible();
      clearHideTimer();
      return;
    }

    state.controlsLockedVisible = false;
    showControlsNow();
  }

  function startBoost() {
    const video = getVideo();
    if (!video) return;

    state.restoreRate = video.playbackRate || 1;
    state.isBoosting = true;
    state.didBoostThisPress = true;
    video.playbackRate = state.boostRate;

    showControlsNow();
    renderUI();
  }

  function stopBoost() {
    const video = getVideo();
    if (!video || !state.isBoosting) return;

    video.playbackRate = state.restoreRate || 1;
    state.isBoosting = false;

    showControlsNow();
    renderUI();
  }

  function togglePlayPause() {
    const video = getVideo();
    if (!video) return;

    if (video.paused) {
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } else {
      video.pause();
    }

    showControlsNow();
    renderUI();
  }

  function shouldHandleSpace(event) {
    if (event.code !== 'Space') return false;

    const video = getVideo();
    if (!video) return false;

    const target = event.target;
    const active = document.activeElement;

    if (inOurUi(target)) return false;
    if (isEditable(target) || isEditable(active)) return false;

    return true;
  }

  function onKeyDown(event) {
    if (!shouldHandleSpace(event)) return;

    if (state.isSpaceDown) {
      stopEvent(event);
      return;
    }

    state.isSpaceDown = true;
    state.didBoostThisPress = false;
    clearTimeout(state.holdTimer);

    state.holdTimer = window.setTimeout(() => {
      startBoost();
    }, CONFIG.holdDelayMs);

    stopEvent(event);
  }

  function onKeyUp(event) {
    if (event.code !== 'Space') return;
    if (!state.isSpaceDown) return;

    state.isSpaceDown = false;
    clearTimeout(state.holdTimer);

    if (state.didBoostThisPress || state.isBoosting) {
      stopBoost();
      stopEvent(event);
      return;
    }

    if (getVideo()) {
      togglePlayPause();
      stopEvent(event);
    }
  }

  function bindVideo(video) {
    if (!video || video === state.currentVideo) return;

    if (state.currentVideo && state.currentVideo._apvRefreshHandler) {
      const old = state.currentVideo._apvRefreshHandler;
      state.currentVideo.removeEventListener('play', old);
      state.currentVideo.removeEventListener('pause', old);
      state.currentVideo.removeEventListener('ratechange', old);
      state.currentVideo.removeEventListener('loadedmetadata', old);
      state.currentVideo.removeEventListener('ended', old);
      state.currentVideo.removeEventListener('seeking', old);
      state.currentVideo.removeEventListener('seeked', old);
    }

    const refresh = () => {
      renderUI();
      syncControlsState();
    };

    video.addEventListener('play', refresh);
    video.addEventListener('pause', refresh);
    video.addEventListener('ratechange', refresh);
    video.addEventListener('loadedmetadata', refresh);
    video.addEventListener('ended', refresh);
    video.addEventListener('seeking', refresh);
    video.addEventListener('seeked', refresh);

    video._apvRefreshHandler = refresh;
    state.currentVideo = video;

    renderUI();
    syncControlsState();
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function startDrag(clientX, clientY) {
    const rect = ui.root.getBoundingClientRect();
    state.drag = {
      startX: clientX,
      startY: clientY,
      left: rect.left,
      top: rect.top
    };

    ui.root.style.right = 'auto';
    ui.root.style.bottom = 'auto';
    ui.root.style.left = `${rect.left}px`;
    ui.root.style.top = `${rect.top}px`;
  }

  function moveDrag(clientX, clientY) {
    if (!state.drag) return;

    const nextLeft = clamp(
      state.drag.left + (clientX - state.drag.startX),
      CONFIG.dragMargin,
      window.innerWidth - ui.root.offsetWidth - CONFIG.dragMargin
    );

    const nextTop = clamp(
      state.drag.top + (clientY - state.drag.startY),
      CONFIG.dragMargin,
      window.innerHeight - ui.root.offsetHeight - CONFIG.dragMargin
    );

    ui.root.style.left = `${nextLeft}px`;
    ui.root.style.top = `${nextTop}px`;
  }

  function endDrag() {
    state.drag = null;
  }

  ui.header.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    startDrag(event.clientX, event.clientY);
    event.preventDefault();
  });

  document.addEventListener('mousemove', (event) => {
    moveDrag(event.clientX, event.clientY);
  }, { passive: true });

  document.addEventListener('mouseup', endDrag, { passive: true });
  document.addEventListener('mouseleave', endDrag, { passive: true });

  ui.header.addEventListener('touchstart', (event) => {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    startDrag(touch.clientX, touch.clientY);
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    moveDrag(touch.clientX, touch.clientY);
  }, { passive: true });

  document.addEventListener('touchend', endDrag, { passive: true });

  function onPlayerActivity(event) {
    if (!getPlayer()) return;
    if (!(event.target instanceof Element)) return;

    const player = getPlayer();
    if (!player || !player.contains(event.target)) return;

    if (isPaused()) {
      setControlsVisible();
      clearHideTimer();
      return;
    }

    showControlsNow();
  }

  function poll() {
    bindVideo(getVideo());
    renderUI();
    syncControlsState();
  }

  document.addEventListener('keydown', onKeyDown, { capture: true, passive: false });
  document.addEventListener('keyup', onKeyUp, { capture: true, passive: false });

  document.addEventListener('mousemove', onPlayerActivity, { passive: true, capture: true });
  document.addEventListener('click', onPlayerActivity, { passive: true, capture: true });
  document.addEventListener('pointermove', onPlayerActivity, { passive: true, capture: true });
  document.addEventListener('touchstart', onPlayerActivity, { passive: true, capture: true });

  poll();
  state.pollTimer = window.setInterval(poll, CONFIG.pollMs);
})();