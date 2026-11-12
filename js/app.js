/*
 * Sherlock Media Player: UI wiring.
 *
 * A single <video> element plays both audio and video. Audio-only tracks
 * hide the video surface and show a cover card plus a spectrum visualizer
 * driven by the Web Audio API.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {
    app: $('app'),
    stage: $('stage'),
    media: $('media'),
    canvas: $('visualizer'),
    audioCard: $('audio-card'),
    audioTitle: $('audio-title'),
    emptyState: $('empty-state'),
    flash: $('stage-flash'),
    fileInput: $('file-input'),
    playlist: $('playlist'),
    playlistEmpty: $('playlist-empty'),
    playlistCount: $('playlist-count'),
    clearBtn: $('clear-btn'),
    seek: $('seek'),
    currentTime: $('current-time'),
    duration: $('duration'),
    nowPlaying: $('now-playing'),
    playBtn: $('play-btn'),
    prevBtn: $('prev-btn'),
    nextBtn: $('next-btn'),
    shuffleBtn: $('shuffle-btn'),
    repeatBtn: $('repeat-btn'),
    muteBtn: $('mute-btn'),
    volume: $('volume'),
    speed: $('speed'),
    pipBtn: $('pip-btn'),
    fullscreenBtn: $('fullscreen-btn'),
    helpBtn: $('help-btn'),
    helpDialog: $('help-dialog'),
  };

  const media = els.media;
  const playlist = new Playlist();

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i;
  const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|mov|mkv)$/i;

  function kindOf(file) {
    if (file.type.startsWith('audio/')) return 'audio';
    if (file.type.startsWith('video/')) return 'video';
    if (AUDIO_EXT.test(file.name)) return 'audio';
    if (VIDEO_EXT.test(file.name)) return 'video';
    return null;
  }

  function displayName(fileName) {
    return fileName.replace(/\.[^.]+$/, '') || fileName;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    const ss = String(s).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  function setRangeFill(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 0;
    const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', `${pct}%`);
  }

  let flashTimer = null;
  function flash(message) {
    els.flash.textContent = message;
    els.flash.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => els.flash.classList.remove('show'), 900);
  }

  // ---------------------------------------------------------------------
  // Settings persistence
  // ---------------------------------------------------------------------

  const SETTINGS_KEY = 'sherlock.settings';

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        volume: media.volume,
        muted: media.muted,
        speed: media.playbackRate,
        shuffle: playlist.shuffle,
        repeat: playlist.repeat,
      }));
    } catch {
      /* storage unavailable (private mode, file:// in some browsers) */
    }
  }

  // ---------------------------------------------------------------------
  // Adding / removing tracks
  // ---------------------------------------------------------------------

  function addFiles(fileList) {
    const files = Array.from(fileList);
    const accepted = [];
    let skipped = 0;

    for (const file of files) {
      const kind = kindOf(file);
      if (!kind) {
        skipped++;
        continue;
      }
      accepted.push({ name: displayName(file.name), kind, url: URL.createObjectURL(file) });
    }

    if (skipped) flash(`Skipped ${skipped} unsupported file${skipped > 1 ? 's' : ''}`);
    if (!accepted.length) return;

    const wasEmpty = !playlist.current;
    const added = playlist.add(accepted);
    added.forEach(probeDuration);
    renderPlaylist();
    updateTransportState();

    if (wasEmpty) loadItem(added[0], { autoplay: true });
  }

  /** Reads a track's duration without disturbing the main player. */
  function probeDuration(item) {
    const probe = document.createElement(item.kind === 'video' ? 'video' : 'audio');
    probe.preload = 'metadata';
    const done = () => {
      probe.removeAttribute('src');
      probe.load();
    };
    probe.addEventListener('loadedmetadata', () => {
      item.duration = probe.duration;
      updateTrackRow(item);
      done();
    }, { once: true });
    probe.addEventListener('error', () => {
      item.error = true;
      updateTrackRow(item);
      done();
    }, { once: true });
    probe.src = item.url;
  }

  function removeTrack(index) {
    const wasCurrent = playlist.items[index] && playlist.items[index].id === playlist.currentId;
    const wasPlaying = wasCurrent && !media.paused;
    const removed = playlist.remove(index);
    if (!removed) return;
    URL.revokeObjectURL(removed.url);

    if (wasCurrent) {
      // Continue with whatever slid into the removed track's slot.
      const replacement = playlist.items[index] || playlist.items[index - 1];
      if (replacement) loadItem(replacement, { autoplay: wasPlaying });
      else resetPlayer();
    }
    renderPlaylist();
    updateTransportState();
  }

  function clearPlaylist() {
    playlist.clear().forEach((item) => URL.revokeObjectURL(item.url));
    resetPlayer();
    renderPlaylist();
    updateTransportState();
  }

  function resetPlayer() {
    media.pause();
    media.removeAttribute('src');
    media.load();
    els.stage.classList.remove('is-audio', 'is-playing');
    els.audioCard.hidden = true;
    els.emptyState.hidden = false;
    els.nowPlaying.classList.remove('active');
    els.nowPlaying.querySelector('.np-label').textContent = 'Nothing playing';
    document.title = 'Sherlock Media Player';
    els.pipBtn.hidden = true;
    updateTime();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }

  // ---------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------

  function loadItem(item, { autoplay = false } = {}) {
    playlist.select(item.id);
    media.src = item.url;
    media.playbackRate = Number(els.speed.value);

    showAsAudio(item.kind === 'audio');
    els.emptyState.hidden = true;
    els.audioTitle.textContent = item.name;
    els.nowPlaying.classList.add('active');
    els.nowPlaying.querySelector('.np-label').textContent = item.name;
    els.nowPlaying.title = item.name;
    document.title = `${item.name} · Sherlock`;

    if ('mediaSession' in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: item.name, artist: 'Sherlock' });
    }

    renderPlaylist();
    updateTransportState();
    if (autoplay) play();
  }

  function showAsAudio(isAudio) {
    els.stage.classList.toggle('is-audio', isAudio);
    els.audioCard.hidden = !isAudio;
    els.pipBtn.hidden = isAudio || !document.pictureInPictureEnabled;
  }

  function play() {
    if (!media.src) return;
    ensureAudioGraph();
    const p = media.play();
    if (p && p.catch) {
      p.catch((err) => {
        if (err.name !== 'AbortError') console.warn('Playback failed:', err);
      });
    }
  }

  function togglePlay() {
    if (!playlist.current) {
      if (playlist.length) loadItem(playlist.getById(playlist.order[0]), { autoplay: true });
      return;
    }
    if (media.paused || media.ended) play();
    else media.pause();
  }

  function next({ auto = false } = {}) {
    const item = playlist.getNext({ auto });
    if (!item) {
      if (auto) {
        // End of playlist: stop on the last track.
        media.pause();
        media.currentTime = 0;
      }
      return;
    }
    if (item.id === playlist.currentId) {
      media.currentTime = 0;
      play();
    } else {
      loadItem(item, { autoplay: auto || !media.paused });
    }
  }

  function previous() {
    // Like most players: restart the track unless we're near its start.
    if (media.currentTime > 3) {
      media.currentTime = 0;
      return;
    }
    const item = playlist.getPrevious();
    if (!item) return;
    if (item.id === playlist.currentId) media.currentTime = 0;
    else loadItem(item, { autoplay: !media.paused });
  }

  function seekBy(seconds) {
    if (!Number.isFinite(media.duration)) return;
    media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + seconds));
    flash(`${seconds > 0 ? '+' : '−'}${Math.abs(seconds)}s`);
  }

  function setVolume(v) {
    media.volume = Math.max(0, Math.min(1, v));
    if (media.volume > 0) media.muted = false;
    flash(media.muted ? 'Muted' : `Volume ${Math.round(media.volume * 100)}%`);
  }

  function toggleMute() {
    media.muted = !media.muted;
    flash(media.muted ? 'Muted' : `Volume ${Math.round(media.volume * 100)}%`);
  }

  function toggleShuffle() {
    playlist.setShuffle(!playlist.shuffle);
    updateModeButtons();
    flash(`Shuffle ${playlist.shuffle ? 'on' : 'off'}`);
    saveSettings();
  }

  function cycleRepeat() {
    const mode = playlist.cycleRepeat();
    updateModeButtons();
    flash({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[mode]);
    saveSettings();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (playlist.current) els.stage.requestFullscreen().catch(() => {});
  }

  async function togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await media.requestPictureInPicture();
    } catch (err) {
      console.warn('Picture-in-picture failed:', err);
    }
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  const ICON_PLAYING = '<svg class="track-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
  const ICON_REMOVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  function renderPlaylist() {
    const frag = document.createDocumentFragment();
    playlist.items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'track';
      li.dataset.id = item.id;
      li.draggable = true;
      li.classList.toggle('is-current', item.id === playlist.currentId);
      li.innerHTML = `
        <span class="track-index">${index + 1}</span>
        ${ICON_PLAYING}
        <div class="track-main">
          <div class="track-name"></div>
          <div class="track-kind"></div>
        </div>
        <span class="track-duration"></span>
        <button class="track-remove" type="button" aria-label="Remove from playlist" title="Remove">${ICON_REMOVE}</button>`;
      li.querySelector('.track-name').textContent = item.name;
      li.title = item.name;
      fillTrackMeta(li, item);
      frag.appendChild(li);
    });
    els.playlist.replaceChildren(frag);

    els.playlistCount.textContent = playlist.length;
    els.playlistEmpty.hidden = playlist.length > 0;
    els.clearBtn.disabled = playlist.length === 0;

    const current = els.playlist.querySelector('.is-current');
    if (current) current.scrollIntoView({ block: 'nearest' });
  }

  function fillTrackMeta(li, item) {
    li.querySelector('.track-kind').textContent = item.error ? 'Unsupported format' : item.kind;
    li.querySelector('.track-duration').textContent = item.duration != null ? formatTime(item.duration) : '';
  }

  function updateTrackRow(item) {
    const li = els.playlist.querySelector(`.track[data-id="${item.id}"]`);
    if (li) fillTrackMeta(li, item);
  }

  function updateTransportState() {
    const has = playlist.length > 0;
    els.playBtn.disabled = !has;
    els.prevBtn.disabled = !has;
    els.nextBtn.disabled = !has;
  }

  function updatePlayState() {
    const playing = !media.paused && !media.ended;
    els.playBtn.classList.toggle('is-playing', playing);
    els.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    els.playBtn.title = playing ? 'Pause (Space)' : 'Play (Space)';
    els.stage.classList.toggle('is-playing', playing);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
    if (playing) startVisualizer();
  }

  let userSeeking = false;
  function updateTime() {
    const duration = Number.isFinite(media.duration) ? media.duration : 0;
    els.seek.max = duration;
    els.seek.disabled = duration === 0;
    if (!userSeeking) els.seek.value = media.currentTime || 0;
    setRangeFill(els.seek);
    els.currentTime.textContent = formatTime(userSeeking ? Number(els.seek.value) : media.currentTime);
    els.duration.textContent = formatTime(duration);
  }

  function updateVolumeUI() {
    els.volume.value = media.muted ? 0 : media.volume;
    setRangeFill(els.volume);
    els.muteBtn.classList.toggle('is-muted', media.muted || media.volume === 0);
    els.muteBtn.setAttribute('aria-label', media.muted ? 'Unmute' : 'Mute');
  }

  function updateModeButtons() {
    els.shuffleBtn.setAttribute('aria-pressed', String(playlist.shuffle));
    const mode = playlist.repeat;
    els.repeatBtn.dataset.mode = mode;
    els.repeatBtn.setAttribute('aria-label', `Repeat: ${mode}`);
    els.repeatBtn.title = `Repeat: ${mode} (R)`;
  }

  // ---------------------------------------------------------------------
  // Audio visualizer
  // ---------------------------------------------------------------------

  let audioCtx = null;
  let analyser = null;
  let freqData = null;
  let rafId = 0;

  function ensureAudioGraph() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      audioCtx = new Ctx();
      const source = audioCtx.createMediaElementSource(media);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
    } catch (err) {
      console.warn('Visualizer unavailable:', err);
      analyser = null;
    }
  }

  function startVisualizer() {
    if (!rafId) rafId = requestAnimationFrame(drawVisualizer);
  }

  function drawVisualizer() {
    rafId = 0;
    const canvas = els.canvas;
    const isAudio = els.stage.classList.contains('is-audio');
    if (!analyser || !isAudio) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    analyser.getByteFrequencyData(freqData);

    // Mirrored bars along the bottom of the stage.
    const bins = Math.floor(freqData.length * 0.75); // top bins are mostly empty
    const barW = w / (bins * 2);
    const gradient = ctx.createLinearGradient(0, h, 0, h * 0.6);
    gradient.addColorStop(0, 'rgba(108, 140, 255, 0.55)');
    gradient.addColorStop(1, 'rgba(163, 108, 255, 0.05)');
    ctx.fillStyle = gradient;
    for (let i = 0; i < bins; i++) {
      const barH = (freqData[i] / 255) * h * 0.4;
      const xRight = w / 2 + i * barW;
      const xLeft = w / 2 - (i + 1) * barW;
      ctx.fillRect(xRight + 1, h - barH, barW - 2, barH);
      ctx.fillRect(xLeft + 1, h - barH, barW - 2, barH);
    }

    // Keep drawing while playing; draw one last frame after pausing.
    if (!media.paused) rafId = requestAnimationFrame(drawVisualizer);
  }

  // ---------------------------------------------------------------------
  // Events: media element
  // ---------------------------------------------------------------------

  media.addEventListener('play', updatePlayState);
  media.addEventListener('pause', updatePlayState);
  media.addEventListener('ended', () => {
    updatePlayState();
    next({ auto: true });
  });
  media.addEventListener('timeupdate', updateTime);
  media.addEventListener('durationchange', updateTime);
  media.addEventListener('emptied', updateTime);
  media.addEventListener('volumechange', () => {
    updateVolumeUI();
    saveSettings();
  });
  media.addEventListener('ratechange', saveSettings);
  media.addEventListener('loadedmetadata', () => {
    const item = playlist.current;
    if (!item) return;
    // e.g. a .webm with only an audio track: treat it as audio.
    if (item.kind === 'video' && media.videoWidth === 0) showAsAudio(true);
    if (item.duration == null) {
      item.duration = media.duration;
      updateTrackRow(item);
    }
  });
  media.addEventListener('error', () => {
    const item = playlist.current;
    if (!item || !media.getAttribute('src')) return;
    item.error = true;
    updateTrackRow(item);
    flash("Can't play this file in this browser");
  });

  // Click the video to play/pause, double-click for fullscreen.
  media.addEventListener('click', togglePlay);
  media.addEventListener('dblclick', toggleFullscreen);
  els.stage.addEventListener('click', (e) => {
    if (e.target === els.stage && els.stage.classList.contains('is-audio')) togglePlay();
  });

  // ---------------------------------------------------------------------
  // Events: controls
  // ---------------------------------------------------------------------

  els.fileInput.addEventListener('change', () => {
    addFiles(els.fileInput.files);
    els.fileInput.value = '';
  });

  els.playBtn.addEventListener('click', togglePlay);
  els.nextBtn.addEventListener('click', () => next());
  els.prevBtn.addEventListener('click', previous);
  els.shuffleBtn.addEventListener('click', toggleShuffle);
  els.repeatBtn.addEventListener('click', cycleRepeat);
  els.muteBtn.addEventListener('click', toggleMute);
  els.fullscreenBtn.addEventListener('click', toggleFullscreen);
  els.pipBtn.addEventListener('click', togglePip);
  els.clearBtn.addEventListener('click', clearPlaylist);
  els.helpBtn.addEventListener('click', () => els.helpDialog.showModal());

  els.seek.addEventListener('input', () => {
    userSeeking = true;
    updateTime();
  });
  els.seek.addEventListener('change', () => {
    media.currentTime = Number(els.seek.value);
    userSeeking = false;
    updateTime();
  });

  els.volume.addEventListener('input', () => {
    media.volume = Number(els.volume.value);
    media.muted = media.volume === 0;
  });

  els.speed.addEventListener('change', () => {
    media.playbackRate = Number(els.speed.value);
    media.defaultPlaybackRate = media.playbackRate;
  });

  document.addEventListener('fullscreenchange', () => {
    els.fullscreenBtn.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen');
  });

  // ---------------------------------------------------------------------
  // Events: playlist interactions
  // ---------------------------------------------------------------------

  els.playlist.addEventListener('click', (e) => {
    const li = e.target.closest('.track');
    if (!li) return;
    const index = playlist.indexOf(Number(li.dataset.id));
    if (e.target.closest('.track-remove')) {
      removeTrack(index);
      return;
    }
    const item = playlist.items[index];
    if (item.id === playlist.currentId) togglePlay();
    else loadItem(item, { autoplay: true });
  });

  // Drag & drop reordering inside the playlist.
  let dragFromIndex = -1;

  function clearDropMarkers() {
    els.playlist.querySelectorAll('.drop-before, .drop-after')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  els.playlist.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.track');
    if (!li) return;
    dragFromIndex = playlist.indexOf(Number(li.dataset.id));
    li.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.title);
  });

  els.playlist.addEventListener('dragover', (e) => {
    if (dragFromIndex < 0) return;
    const li = e.target.closest('.track');
    if (!li) return;
    e.preventDefault();
    clearDropMarkers();
    const rect = li.getBoundingClientRect();
    li.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
  });

  els.playlist.addEventListener('drop', (e) => {
    if (dragFromIndex < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const li = els.playlist.querySelector('.drop-before, .drop-after');
    if (li) {
      const target = playlist.indexOf(Number(li.dataset.id));
      const after = li.classList.contains('drop-after');
      let to = after ? target + 1 : target;
      if (dragFromIndex < to) to--;
      playlist.move(dragFromIndex, to);
      renderPlaylist();
    }
  });

  els.playlist.addEventListener('dragend', () => {
    dragFromIndex = -1;
    clearDropMarkers();
    els.playlist.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
  });

  // Dropping files from the desktop anywhere on the window.
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    els.app.classList.add('is-dragging');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) els.app.classList.remove('is-dragging');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    els.app.classList.remove('is-dragging');
    addFiles(e.dataTransfer.files);
  });

  // ---------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.matches('input[type="text"], input[type="search"], textarea, select')) return;
    if (els.helpDialog.open) return;
    const onRange = t.matches('input[type="range"]');

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    switch (key) {
      case ' ':
      case 'k': togglePlay(); break;
      case 'ArrowRight': if (onRange) return; seekBy(5); break;
      case 'ArrowLeft': if (onRange) return; seekBy(-5); break;
      case 'l': seekBy(10); break;
      case 'j': seekBy(-10); break;
      case 'ArrowUp': if (onRange) return; setVolume(media.volume + 0.05); break;
      case 'ArrowDown': if (onRange) return; setVolume(media.volume - 0.05); break;
      case 'n': next(); break;
      case 'p': previous(); break;
      case 'm': toggleMute(); break;
      case 'f': toggleFullscreen(); break;
      case 's': toggleShuffle(); break;
      case 'r': cycleRepeat(); break;
      case '?': els.helpDialog.showModal(); break;
      default:
        if (/^[0-9]$/.test(key) && Number.isFinite(media.duration)) {
          media.currentTime = (media.duration * Number(key)) / 10;
        } else {
          handled = false;
        }
    }
    if (handled) e.preventDefault();
  });

  // ---------------------------------------------------------------------
  // OS media keys / lock-screen controls
  // ---------------------------------------------------------------------

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const handlers = {
      play: () => play(),
      pause: () => media.pause(),
      nexttrack: () => next(),
      previoustrack: () => previous(),
      seekforward: () => seekBy(10),
      seekbackward: () => seekBy(-10),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported in this browser */
      }
    }
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  const settings = loadSettings();
  if (typeof settings.volume === 'number') media.volume = settings.volume;
  if (typeof settings.muted === 'boolean') media.muted = settings.muted;
  if (settings.speed && [...els.speed.options].some((o) => Number(o.value) === settings.speed)) {
    els.speed.value = String(settings.speed);
    media.defaultPlaybackRate = settings.speed;
  }
  if (settings.shuffle) playlist.setShuffle(true);
  if (Playlist.REPEAT_MODES.includes(settings.repeat)) playlist.setRepeat(settings.repeat);

  updateVolumeUI();
  updateModeButtons();
  updateTransportState();
  updateTime();
  renderPlaylist();

  // Exposed for debugging and tests.
  window.sherlock = { playlist, media, addFiles };
})();
