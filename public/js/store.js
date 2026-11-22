// Persistent player profile in localStorage.

import { POWERUPS, MAX_LEVEL, UPGRADE_COST } from '/shared/constants.js';

const KEY = 'byterush.v1';

const DEFAULTS = () => ({
  name: '',
  coins: 0,
  best: 0,
  bestDist: 0,
  bestChain: 0,
  levels: { bomb: 1, freeze: 1, shield: 1 }, // presence = unlocked
  loadout: ['bomb', 'freeze', 'shield'],
  settings: { sound: true, music: true, dpad: false, haptics: true },
  stats: { games: 0, dots: 0, kills: 0 },
  seenTutorial: false,
});

export class Store {
  constructor() {
    this.data = DEFAULTS();
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved) {
        const d = DEFAULTS();
        this.data = { ...d, ...saved, settings: { ...d.settings, ...saved.settings }, stats: { ...d.stats, ...saved.stats } };
      }
    } catch { /* ignore */ }
    if (!this.data.name) this.data.name = 'Bit' + Math.floor(100 + Math.random() * 900);
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ } }

  isUnlocked(id) { return !!this.data.levels[id]; }
  level(id) { return this.data.levels[id] || 0; }

  loadoutForGame() {
    return this.data.loadout.filter((id) => POWERUPS[id] && this.isUnlocked(id)).map((id) => ({ id, lvl: this.level(id) }));
  }

  unlock(id) {
    const cost = POWERUPS[id].unlock;
    if (this.isUnlocked(id) || this.data.coins < cost) return false;
    this.data.coins -= cost;
    this.data.levels[id] = 1;
    if (this.data.loadout.length < 3) this.data.loadout.push(id);
    this.save();
    return true;
  }

  upgradeCost(id) {
    const l = this.level(id);
    return l >= MAX_LEVEL ? null : UPGRADE_COST[l];
  }

  upgrade(id) {
    const cost = this.upgradeCost(id);
    if (cost == null || this.data.coins < cost) return false;
    this.data.coins -= cost;
    this.data.levels[id]++;
    this.save();
    return true;
  }

  toggleEquip(id) {
    const lo = this.data.loadout;
    const i = lo.indexOf(id);
    if (i >= 0) { if (lo.length > 1) lo.splice(i, 1); else return false; }
    else if (lo.length < 3) lo.push(id);
    else { lo.shift(); lo.push(id); }
    this.save();
    return true;
  }

  // Record a finished game; returns { coinsEarned, newBest }.
  recordGame({ score, distance, chain, coins, dots, kills }) {
    const d = this.data;
    const earned = coins + Math.floor(score / 2500) + Math.floor(distance / 60);
    d.coins += earned;
    const newBest = score > d.best;
    if (newBest) d.best = score;
    d.bestDist = Math.max(d.bestDist, distance);
    d.bestChain = Math.max(d.bestChain, chain);
    d.stats.games++;
    d.stats.dots += dots || 0;
    d.stats.kills += kills || 0;
    this.save();
    return { coinsEarned: earned, newBest };
  }
}
