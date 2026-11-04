// Everything drawn in HTML on top of the 3D view.
import { ROOM_NAMES, STAGES, stageIndex } from '../../shared/constants.js';

const $ = (id) => document.getElementById(id);

const STEPS = [
  ['lamps', 'Lamp code'],
  ['safe', 'Safe'],
  ['gear', 'Gear'],
  ['clock', 'Clock'],
  ['levers', 'Levers'],
];

const HINTS = {
  lamps: {
    study: 'Ring the brass bell on your desk and watch the four lamps. Call out the colours to your partner, in order. You can ring it again.',
    workshop: 'Your partner can see a colour code. Press the coloured buttons on your panel in the order they call out. The little bulbs show your progress.',
  },
  safe: {
    study: 'Click each safe dial to turn it. Your partner can see which three symbols you need, left to right.',
    workshop: 'The curtain lifted! Describe the three chalkboard symbols to your partner, left to right. Click the board to see it up close.',
  },
  gear: {
    study: 'Take the brass gear from the safe, then click the brass Pneumatic Post on the wall to send it to your partner. Also read the note in the safe!',
    workshop: 'Watch your Pneumatic Post. When something arrives, take it and fix the grandfather clock with it.',
  },
  clock: {
    study: "Read the note from the safe out loud. It's the time the clock must show.",
    workshop: 'Turn the H and M knobs on the clock until it shows the time your partner reads from their note.',
  },
  levers: {
    study: 'Both lever lights are green. Count down together, "3, 2, 1, pull!", and pull at the same moment.',
    workshop: 'Both lever lights are green. Count down together, "3, 2, 1, pull!", and pull at the same moment.',
  },
};

export class Hud {
  constructor() {
    this.toastBox = $('toasts');
    this.tooltipTimer = null;
    this.progress = $('progress');
    for (const [stage, label] of STEPS) {
      const li = document.createElement('li');
      li.dataset.stage = stage;
      li.textContent = label;
      this.progress.appendChild(li);
    }
    $('inspect-close').addEventListener('click', () => $('inspect').classList.add('hidden'));
    $('inspect').addEventListener('click', (e) => {
      if (e.target.id === 'inspect') $('inspect').classList.add('hidden');
    });
  }

  // ---------- lobby ----------

  showNameStep(defaults, onSubmit) {
    const form = $('step-name');
    form.classList.remove('hidden');
    $('in-name').value = defaults.name || '';
    $('in-room').value = defaults.room;
    if (!defaults.name) $('in-name').focus();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('in-name').value.trim() || 'Detective';
      const room = $('in-room').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || defaults.room;
      form.classList.add('hidden');
      onSubmit(name, room);
    });
  }

  showRoleStep({ onPick, onEnter, shareLink }) {
    $('step-role').classList.remove('hidden');
    for (const el of document.querySelectorAll('#step-role [data-role]')) {
      el.addEventListener('click', () => onPick(el.dataset.role));
    }
    $('btn-enter').addEventListener('click', onEnter);
    if (shareLink) {
      $('share').classList.remove('hidden');
      $('share-link').textContent = shareLink;
      $('btn-copy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(shareLink);
          $('btn-copy').textContent = 'Copied!';
        } catch {
          $('btn-copy').textContent = 'Copy failed';
        }
        setTimeout(() => ($('btn-copy').textContent = 'Copy'), 1500);
      });
    }
  }

  openLobby() {
    $('lobby').classList.remove('hidden');
    $('hud').classList.add('hidden');
  }

  closeLobby() {
    $('lobby').classList.add('hidden');
    $('hud').classList.remove('hidden');
  }

  lobbyOpen() {
    return !$('lobby').classList.contains('hidden');
  }

  status(text, error = false) {
    const el = $('lobby-status');
    el.textContent = text;
    el.classList.toggle('error', error);
  }

  // ---------- per-state updates ----------

  update(state, me) {
    const role = me.role;
    for (const r of ['study', 'workshop']) {
      const card = document.querySelector(`.role[data-role="${r}"]`);
      const holder = state.roles[r];
      card.classList.toggle('mine', role === r);
      card.classList.toggle('taken', !!holder && holder.id !== me.clientId);
      document.querySelector(`[data-who="${r}"]`).textContent = holder
        ? holder.id === me.clientId
          ? 'You'
          : holder.name
        : 'Empty';
    }
    document.querySelector('.link[data-role="spectator"]').classList.toggle('mine', role === 'spectator');
    $('btn-enter').textContent = role === 'spectator' ? 'Watch' : `Enter ${ROOM_NAMES[role]}`;

    $('room-name').textContent = role === 'spectator' ? `Watching ${ROOM_NAMES[me.view]}` : ROOM_NAMES[role];
    const si = stageIndex(state.stage);
    for (const li of this.progress.children) {
      const i = STAGES.indexOf(li.dataset.stage);
      li.classList.toggle('done', i < si);
      li.classList.toggle('current', i === si);
    }

    const partnerRole = role === 'study' ? 'workshop' : role === 'workshop' ? 'study' : null;
    const partner = $('partner');
    partner.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'dot';
    if (partnerRole) {
      const p = state.roles[partnerRole];
      dot.classList.toggle('on', !!p);
      partner.append(dot);
      if (p) {
        const b = document.createElement('b');
        b.textContent = p.name;
        partner.append(b, ` · ${ROOM_NAMES[partnerRole]}`);
      } else {
        partner.append(`Waiting for someone in ${ROOM_NAMES[partnerRole]}…`);
      }
    } else {
      const names = ['study', 'workshop'].map((r) => state.roles[r]?.name || '—');
      dot.classList.add('on');
      partner.append(dot, `${names[0]} & ${names[1]}`);
    }

    $('spectate').classList.toggle('hidden', role !== 'spectator');
    for (const b of document.querySelectorAll('#spectate button')) b.classList.toggle('active', b.dataset.view === me.view);

    $('holding').classList.toggle('hidden', state.gear !== `${role}-hand`);
    $('btn-new').classList.toggle('hidden', state.stage !== 'won');

    const feed = $('feed');
    const items = state.log.slice(-4);
    if (feed.dataset.sig !== items.map((l) => l.t + l.text).join('|')) {
      feed.dataset.sig = items.map((l) => l.t + l.text).join('|');
      feed.replaceChildren(
        ...items.map((l) => {
          const li = document.createElement('li');
          li.textContent = l.text;
          return li;
        }),
      );
    }
  }

  timer(state, serverOffset) {
    const el = $('timer');
    if (!state?.startedAt) {
      el.textContent = '00:00';
      return;
    }
    const end = state.finishedAt || Date.now() + serverOffset;
    el.textContent = formatDuration(end - state.startedAt);
  }

  partnerLook(text) {
    $('partner-look').textContent = text;
  }

  hint(state, role) {
    if (role === 'spectator') return this.toast('Spectators get no hints. Just enjoy the show!');
    if (state.stage === 'won') return this.toast('You did it! Press New case to play again with a fresh puzzle.');
    const stage = state.stage;
    let text = HINTS[stage]?.[role];
    if (stage === 'gear' && role === 'workshop' && state.gear === 'workshop-hand') text = 'Click the grandfather clock to fit the gear into its works.';
    if (stage === 'gear' && role === 'study' && state.gear !== 'safe' && state.gear !== 'study-hand') text = 'The gear is on its way. Make sure your partner takes it. Meanwhile, read them the note in the safe.';
    this.toast(text, { ms: 7000 });
  }

  tooltip(text, ms = 0) {
    const el = $('tooltip');
    clearTimeout(this.tooltipTimer);
    if (!text) return el.classList.add('hidden');
    el.textContent = text;
    el.classList.remove('hidden');
    if (ms) this.tooltipTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  toast(text, { big = false, ms = 3500 } = {}) {
    const el = document.createElement('div');
    el.className = `toast${big ? ' big' : ''}`;
    el.textContent = text;
    this.toastBox.appendChild(el);
    while (this.toastBox.children.length > 3) this.toastBox.firstChild.remove();
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 450);
  }

  inspect(canvas, caption) {
    $('inspect-img').src = canvas.toDataURL();
    $('inspect-caption').textContent = caption;
    $('inspect').classList.remove('hidden');
  }

  victory(state) {
    $('victory-time').textContent = `Solved in ${formatDuration(state.finishedAt - state.startedAt)}`;
    const names = ['study', 'workshop'].map((r) => state.roles[r]?.name).filter(Boolean);
    $('victory-names').textContent = names.length === 2 ? `Detectives ${names[0]} & ${names[1]}` : '';
    $('victory').classList.remove('hidden');
  }

  hideVictory() {
    $('victory').classList.add('hidden');
  }
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
