// Builds the Study and the Workshop, and keeps every prop in sync with the shared game state.
import * as THREE from 'three';
import { LAMP_COLORS, LAMP_HEX, SYMBOLS, SAFE_DIALS, formatTime, stageIndex } from '../../shared/constants.js';
import * as T from './textures.js';
import { sfx } from './audio.js';

const H = 3.2; // ceiling height
const D = 3; // rooms run from z = -D to z = +D
const STUDY = { x0: -6, x1: -0.1, cx: -3.05 };
const SHOP = { x0: 0.1, x1: 6, cx: 3.05 };

export const VIEWPOINTS = {
  study: { pos: new THREE.Vector3(STUDY.cx, 1.6, 0.3), yaw: 0 },
  workshop: { pos: new THREE.Vector3(SHOP.cx, 1.6, 0.3), yaw: 0 },
};

const LAMP_STEP = 0.85; // seconds per flash in the lamp sequence
const LAMP_ON = 0.6;

// ---------- small helpers ----------

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });

function mesh(geo, material, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}

const box = (w, h, d, material, x, y, z, parent) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent);

function cyl(rTop, rBot, h, material, x, y, z, parent, seg = 24) {
  return mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), material, x, y, z, parent);
}

function sphere(r, material, x, y, z, parent, seg = 20) {
  return mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2)), material, x, y, z, parent);
}

function group(x = 0, y = 0, z = 0, parent = null) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

function texturedPlane(w, h, tex, parent, { x = 0, y = 0, z = 0, ry = 0, rx = 0, emissive = false, ...o } = {}) {
  const material = std(0xffffff, { map: tex, ...o });
  if (emissive) {
    material.emissive = new THREE.Color(0xffffff);
    material.emissiveMap = tex;
    material.emissiveIntensity = 0.08;
  }
  const m = mesh(new THREE.PlaneGeometry(w, h), material, x, y, z, parent);
  m.rotation.set(rx, ry, 0);
  return m;
}

function gearGeometry(r = 0.13, teeth = 12, depth = 0.035) {
  const shape = new THREE.Shape();
  const inner = r * 0.8;
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [inner, a],
      [r, a + step * 0.12],
      [r, a + step * 0.42],
      [inner, a + step * 0.54],
    ];
    for (const [rad, ang] of pts) {
      const fn = i === 0 && rad === inner && ang === a ? 'moveTo' : 'lineTo';
      shape[fn](Math.cos(ang) * rad, Math.sin(ang) * rad);
    }
  }
  shape.closePath();
  const hub = new THREE.Path();
  hub.absarc(0, 0, r * 0.18, 0, Math.PI * 2, true);
  shape.holes.push(hub);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const hole = new THREE.Path();
    hole.absarc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.17, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 1,
    curveSegments: 10,
  });
  geo.center();
  return geo;
}

// ---------- the rooms ----------

export class Rooms {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.state = null;
    this.viewRoom = 'study';
    this.myRole = 'spectator';
    this.interactives = [];

    const brassBase = { metalness: 0.85, roughness: 0.32 };
    this.mat = {
      brass: std(0xc99b46, brassBase),
      darkBrass: std(0x8a6a2c, brassBase),
      steel: std(0x8d949c, { metalness: 0.8, roughness: 0.4 }),
      iron: std(0x30353a, { metalness: 0.55, roughness: 0.5 }),
      wood: std(0x6e4428, { roughness: 0.6 }),
      darkWood: std(0x3a2414, { roughness: 0.55 }),
      lightWood: std(0x9c7046, { roughness: 0.7 }),
      leather: std(0x5c1c1f, { roughness: 0.55 }),
      safeGreen: std(0x2e4b3c, { metalness: 0.5, roughness: 0.45 }),
      stone: std(0x8c8478, { roughness: 0.95 }),
      soot: std(0x141110, { roughness: 1 }),
      paper: std(0xefe2c2),
      black: std(0x111111, { roughness: 0.4 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xcfe7ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false }),
    };

    this.tex = {
      glow: T.toTexture(T.glow()),
      shadow: T.toTexture(T.contactShadow()),
      dial: SYMBOLS.map((_, i) => T.toTexture(T.dialFace(i))),
    };

    this.anim = { safeDoor: 0, curtain: 0, study: 0, workshop: 0, divider: 0, chest: 0, lid: 0 };
    this.goal = { ...this.anim };
    this.hands = { hour: 0, minute: 0 };
    this.handGoal = { hour: 0, minute: 0 };
    this.flash = null;
    this.buzzUntil = 0;
    this.pressed = {};
    this.tubeGlow = 0;
    this.confettiOn = false;
    this.time = 0;

    this.buildLights();
    this.buildShells();
    this.buildDivider();
    this.buildStudy();
    this.buildWorkshop();
    this.buildGear();
    this.buildVault();
    this.avatars = { study: this.buildAvatar(0x8c2a33), workshop: this.buildAvatar(0x1f6f6b) };

    world.updaters.push((dt, t) => this.update(dt, t));
  }

  interactive(obj, data) {
    obj.userData.interact = { kind: 'server', ...data };
    obj.traverse((m) => {
      if (m.isMesh && m.material && !m.userData.sharedMaterial) m.material = m.material.clone();
    });
    this.interactives.push(obj);
    return obj;
  }

  glowSprite(color, size, parent, x = 0, y = 0, z = 0) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.tex.glow,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      }),
    );
    s.scale.setScalar(size);
    s.position.set(x, y, z);
    s.userData.noHit = true;
    parent.add(s);
    return s;
  }

  contactShadow(x, z, w, d, parent = this.scene) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: this.tex.shadow, transparent: true, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.004, z);
    m.userData.noHit = true;
    parent.add(m);
    return m;
  }

  // ---------- lights & shells ----------

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xffe7c7, 0x2a1e16, 0.55));

    this.studyLight = new THREE.PointLight(0xffc787, 22, 0, 1.6);
    this.studyLight.position.set(STUDY.cx, 2.55, -0.2);
    this.scene.add(this.studyLight);

    this.fireLight = new THREE.PointLight(0xff7a2a, 6, 0, 1.8);
    this.fireLight.position.set(STUDY.cx, 0.6, 2.4);
    this.scene.add(this.fireLight);

    this.shopLights = [-1.2, 1.2].map((z) => {
      const l = new THREE.PointLight(0xffe0b0, 13, 0, 1.6);
      l.position.set(SHOP.cx, 2.5, z);
      this.scene.add(l);
      return l;
    });
  }

  buildShells() {
    const studyFloor = T.toTexture(T.woodPlanks(), { repeat: [3, 3] });
    const shopFloor = T.toTexture(T.stoneTiles(), { repeat: [3, 3] });
    const paper = T.wallpaper();
    const brick = T.bricks();
    const wainscot = T.woodPlanks({ base: '#4a2c18', seed: 9 });
    const ceilingMat = std(0x3b3029, { roughness: 1 });

    const addFloor = (x0, x1, tex) => {
      const w = Math.abs(x1 - x0);
      const m = mesh(new THREE.PlaneGeometry(w, D * 2), std(0xffffff, { map: tex, roughness: 0.8 }), (x0 + x1) / 2, 0, 0, this.scene);
      m.rotation.x = -Math.PI / 2;
      const c = mesh(new THREE.PlaneGeometry(w, D * 2), ceilingMat, (x0 + x1) / 2, H, 0, this.scene);
      c.rotation.x = Math.PI / 2;
    };
    addFloor(-6, 0, studyFloor);
    addFloor(0, 6, shopFloor);

    const wall = (canvasImg, tile, x, z, w, ry, panel) => {
      const tex = T.toTexture(canvasImg, { repeat: [w / tile[0], H / tile[1]] });
      const m = mesh(new THREE.PlaneGeometry(w, H), std(0xffffff, { map: tex, roughness: 0.9 }), x, H / 2, z, this.scene);
      m.rotation.y = ry;
      if (panel) {
        // dark wood wainscoting along the bottom of the Study walls
        const ptex = T.toTexture(wainscot, { repeat: [w / 1.5, 1] });
        const p = mesh(new THREE.PlaneGeometry(w, 0.95), std(0xffffff, { map: ptex, roughness: 0.6 }), 0, 0, 0, this.scene);
        p.position.set(x, 0.475, z).add(new THREE.Vector3(0, 0, 0.012).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry));
        p.rotation.y = ry;
        const rail = box(w, 0.05, 0.04, this.mat.darkWood, 0, 0.96, 0, this.scene);
        rail.position.set(x, 0.96, z).add(new THREE.Vector3(0, 0, 0.02).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry));
        rail.rotation.y = ry;
      }
      const base = box(w, 0.14, 0.04, this.mat.darkWood, 0, 0.07, 0, this.scene);
      base.position.set(x, 0.07, z).add(new THREE.Vector3(0, 0, 0.02).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry));
      base.rotation.y = ry;
      const crown = box(w, 0.1, 0.06, this.mat.darkWood, 0, H - 0.05, 0, this.scene);
      crown.position.set(x, H - 0.05, z).add(new THREE.Vector3(0, 0, 0.03).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry));
      crown.rotation.y = ry;
    };
    // Study: west, north, south (east side is the shared divider)
    wall(paper, [1.2, 1.2], -6, 0, D * 2, Math.PI / 2, true);
    wall(paper, [1.2, 1.2], -3, -D, 6, 0, true);
    wall(paper, [1.2, 1.2], -3, D, 6, Math.PI, true);
    // Workshop: east, north, south
    wall(brick, [2, 2], 6, 0, D * 2, -Math.PI / 2, false);
    wall(brick, [2, 2], 3, -D, 6, 0, false);
    wall(brick, [2, 2], 3, D, 6, Math.PI, false);

    // Pendant lamps
    const pendant = (x, z, shadeColor) => {
      cyl(0.006, 0.006, 0.5, this.mat.black, x, H - 0.25, z, this.scene, 6);
      const shade = cyl(0.06, 0.22, 0.18, std(shadeColor, { side: THREE.DoubleSide, roughness: 0.5 }), x, H - 0.56, z, this.scene);
      shade.geometry = new THREE.CylinderGeometry(0.06, 0.22, 0.18, 24, 1, true);
      const bulb = sphere(0.05, new THREE.MeshBasicMaterial({ color: 0xffe2a8 }), x, H - 0.64, z, this.scene);
      bulb.userData.noHit = true;
      this.glowSprite(0xffc070, 0.9, this.scene, x, H - 0.66, z).material.opacity = 0.55;
    };
    pendant(STUDY.cx, -0.2, 0x2f4d3a);
    pendant(SHOP.cx, -1.2, 0x5c5f63);
    pendant(SHOP.cx, 1.2, 0x5c5f63);
  }

  buildDivider() {
    const g = group(0, 0, 0, this.scene);
    this.divider = g;
    const paper = T.toTexture(T.wallpaper(), { repeat: [D * 2 / 1.2, H / 1.2] });
    const brick = T.toTexture(T.bricks(), { repeat: [D * 2 / 2, H / 2] });
    const plain = std(0x3b3029);
    const mats = [std(0xffffff, { map: brick, roughness: 0.9 }), std(0xffffff, { map: paper, roughness: 0.9 }), plain, plain, plain, plain];
    mesh(new THREE.BoxGeometry(0.2, H, D * 2), mats, 0, H / 2, 0, g);
    // wainscot + trim on the Study side
    const ptex = T.toTexture(T.woodPlanks({ base: '#4a2c18', seed: 9 }), { repeat: [D * 2 / 1.5, 1] });
    const p = mesh(new THREE.PlaneGeometry(D * 2, 0.95), std(0xffffff, { map: ptex, roughness: 0.6 }), -0.112, 0.475, 0, g);
    p.rotation.y = -Math.PI / 2;
    box(0.04, 0.05, D * 2, this.mat.darkWood, -0.12, 0.96, 0, g);
    box(0.04, 0.14, D * 2, this.mat.darkWood, -0.12, 0.07, 0, g);
    box(0.04, 0.14, D * 2, this.mat.darkWood, 0.12, 0.07, 0, g);

    this.tubes = {
      study: this.buildTube(g, -1, 'study'),
      workshop: this.buildTube(g, 1, 'workshop'),
    };
    this.levers = {
      study: this.buildLever(g, -1, 'study'),
      workshop: this.buildLever(g, 1, 'workshop'),
    };
  }

  // A brass "pneumatic post" receiver on one side of the divider. side = -1 (Study) or +1 (Workshop)
  buildTube(parent, side, room) {
    const z = -1.5;
    const g = group(side * 0.1, 0, z, parent);
    const out = (d) => side * d; // distance out from the wall into the room
    cyl(0.07, 0.07, H - 1.55, this.mat.brass, out(0.13), 1.55 + (H - 1.55) / 2, 0, g);
    for (const y of [1.9, 2.5]) cyl(0.085, 0.085, 0.05, this.mat.darkBrass, out(0.13), y, 0, g);
    const funnel = cyl(0.07, 0.17, 0.14, this.mat.brass, out(0.17), 1.47, 0, g);
    funnel.userData.tubePart = true;
    const rx = out(0.18);
    box(0.02, 0.44, 0.46, this.mat.darkBrass, out(0.01), 1.17, 0, g); // back plate
    box(0.34, 0.03, 0.46, this.mat.brass, rx, 1.385, 0, g); // top
    box(0.34, 0.03, 0.46, this.mat.brass, rx, 0.955, 0, g); // tray
    box(0.34, 0.44, 0.02, this.mat.brass, rx, 1.17, -0.22, g);
    box(0.34, 0.44, 0.02, this.mat.brass, rx, 1.17, 0.22, g);
    const inner = box(0.01, 0.4, 0.42, std(0x1a1410), out(0.025), 1.17, 0, g);
    inner.userData.tubePart = true;
    const glow = this.glowSprite(0x9fd4ff, 0.7, g, out(0.2), 1.2, 0);
    texturedPlane(0.42, 0.07, T.toTexture(T.plaque('PNEUMATIC POST', { font: 'bold 52px Georgia, serif' })), g, {
      x: out(0.352),
      y: 1.44,
      ry: side * (Math.PI / 2),
      metalness: 0.6,
      roughness: 0.4,
    });
    this.interactive(g, { id: 'tube', room, label: 'Pneumatic post (send or receive items)' });
    return { group: g, glow, slot: new THREE.Vector3(side * 0.1 + out(0.2), 1.105, z), side };
  }

  buildLever(parent, side, room) {
    const z = 1.5;
    const g = group(side * 0.1, 0, z, parent);
    const out = (d) => side * d;
    box(0.04, 0.55, 0.26, this.mat.iron, out(0.02), 1.2, 0, g);
    box(0.02, 0.4, 0.04, this.mat.black, out(0.045), 1.2, 0, g);
    const pivot = group(out(0.06), 1.15, 0, g);
    cyl(0.04, 0.04, 0.12, this.mat.steel, 0, 0, 0, pivot).rotation.x = Math.PI / 2;
    cyl(0.022, 0.022, 0.5, this.mat.steel, 0, 0.25, 0, pivot);
    sphere(0.065, std(0xb3221c, { roughness: 0.35 }), 0, 0.52, 0, pivot);
    const bulbMat = std(0x440000, { emissive: 0xff2a1a, emissiveIntensity: 1.2 });
    const bulb = sphere(0.04, bulbMat, out(0.05), 1.58, 0, g);
    bulb.userData.noHighlight = true;
    const bulbGlow = this.glowSprite(0xff3b2a, 0.35, g, out(0.08), 1.58, 0);
    bulbGlow.material.opacity = 0.7;
    texturedPlane(0.4, 0.09, T.toTexture(T.plaque('PULL TOGETHER', { font: 'bold 58px Georgia, serif' })), g, {
      x: out(0.025),
      y: 1.72,
      ry: side * (Math.PI / 2),
      metalness: 0.6,
      roughness: 0.4,
    });
    this.interactive(g, { id: 'lever', room, label: 'Big lever' });
    return { pivot, bulb, bulbGlow, side };
  }

  // ---------- the Study ----------

  buildStudy() {
    const cx = STUDY.cx;
    const room = 'study';

    // Rug
    const rug = texturedPlane(3.4, 2.5, T.toTexture(T.rug()), this.scene, { x: cx, y: 0.006, z: 0.2, rx: -Math.PI / 2, roughness: 1 });
    rug.userData.noHit = true;

    // Desk on the north wall
    const desk = group(cx, 0, -2.55, this.scene);
    box(1.7, 0.06, 0.75, this.mat.wood, 0, 0.78, 0, desk);
    for (const [x, z] of [[-0.78, -0.31], [0.78, -0.31], [-0.78, 0.31], [0.78, 0.31]]) box(0.07, 0.75, 0.07, this.mat.darkWood, x, 0.375, z, desk);
    box(1.5, 0.18, 0.02, this.mat.darkWood, 0, 0.66, 0.36, desk);
    sphere(0.025, this.mat.brass, 0, 0.66, 0.38, desk);
    this.contactShadow(cx, -2.55, 2.2, 1.1);
    // books + magnifying glass (flavour)
    const books = group(-0.55, 0.81, -0.12, desk);
    [0x6d1f1f, 0x1f3f6d, 0x2f5a2f].forEach((c, i) => box(0.32 - i * 0.03, 0.06, 0.22, std(c), 0, i * 0.06 + 0.03, 0, books).rotation.y = i * 0.15);
    const mag = group(0.05, 0.82, 0.12, desk);
    const ring = mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 24), this.mat.brass, 0, 0, 0, mag);
    ring.rotation.x = Math.PI / 2;
    const lens = mesh(new THREE.CircleGeometry(0.068, 24), this.mat.glass, 0, 0.001, 0, mag);
    lens.rotation.x = -Math.PI / 2;
    box(0.025, 0.02, 0.14, this.mat.darkWood, 0, 0, 0.14, mag);
    mag.rotation.y = 0.6;
    this.interactive(mag, { id: 'magnifier', room, kind: 'local', label: 'Magnifying glass' });

    // Brass service bell
    const bell = group(0.45, 0.81, 0.1, desk);
    cyl(0.1, 0.11, 0.03, this.mat.darkWood, 0, 0.015, 0, bell);
    const dome = mesh(new THREE.SphereGeometry(0.085, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.mat.brass, 0, 0.03, 0, bell);
    dome.scale.y = 0.85;
    cyl(0.008, 0.008, 0.04, this.mat.brass, 0, 0.12, 0, bell, 8);
    sphere(0.018, this.mat.brass, 0, 0.145, 0, bell);
    this.interactive(bell, { id: 'bell', room, label: 'Brass bell. Ring it!' });
    this.bell = bell;

    // Four coloured lamps on a wall shelf
    const shelf = group(cx, 1.42, -2.86, this.scene);
    box(1.7, 0.05, 0.26, this.mat.darkWood, 0, 0, 0, shelf);
    for (const x of [-0.7, 0.7]) box(0.04, 0.16, 0.2, this.mat.darkWood, x, -0.1, -0.02, shelf);
    this.lamps = {};
    LAMP_COLORS.forEach((color, i) => {
      const x = -0.6 + i * 0.4;
      const hex = LAMP_HEX[color];
      cyl(0.05, 0.07, 0.06, this.mat.brass, x, 0.055, 0.01, shelf);
      cyl(0.015, 0.015, 0.08, this.mat.brass, x, 0.12, 0.01, shelf, 8);
      const globeMat = std(hex, { emissive: hex, emissiveIntensity: 0.05, roughness: 0.15, transparent: true, opacity: 0.9 });
      const globe = sphere(0.11, globeMat, x, 0.27, 0.01, shelf, 28);
      globe.userData.noHighlight = true;
      globe.userData.sharedMaterial = true;
      const glow = this.glowSprite(hex, 0.9, shelf, x, 0.27, 0.09);
      this.lamps[color] = { globe, glow, level: 0 };
    });
    this.interactive(shelf, { id: 'lamps', room, kind: 'local', label: 'Four coloured lamps' });

    texturedPlane(0.9, 0.62, T.toTexture(T.painting('landscape')), this.scene, { x: cx, y: 2.32, z: -2.968, roughness: 0.8 });
    box(0.98, 0.7, 0.03, this.mat.darkBrass, cx, 2.32, -2.99, this.scene);

    // ---- The safe (west wall) ----
    const sz = -0.6;
    const sx = -5.6;
    const safe = group(sx, 0, sz, this.scene);
    box(0.8, 0.1, 1.0, this.mat.darkWood, 0, 0.05, 0, safe);
    const t = 0.06;
    const W = 0.9;
    const Hs = 1.1;
    const Dp = 0.7;
    const y0 = 0.1;
    box(t, Hs, W, this.mat.safeGreen, -Dp / 2 + t / 2, y0 + Hs / 2, 0, safe); // back
    box(Dp, t, W, this.mat.safeGreen, 0, y0 + t / 2, 0, safe); // floor
    box(Dp, t, W, this.mat.safeGreen, 0, y0 + Hs - t / 2, 0, safe); // roof
    box(Dp, Hs, t, this.mat.safeGreen, 0, y0 + Hs / 2, -W / 2 + t / 2, safe);
    box(Dp, Hs, t, this.mat.safeGreen, 0, y0 + Hs / 2, W / 2 - t / 2, safe);
    box(Dp - t, 0.03, W - 2 * t, this.mat.iron, 0, 0.62, 0, safe); // inner shelf
    box(0.02, Hs - 0.1, W - 0.1, std(0x5a1a1a, { roughness: 1 }), -Dp / 2 + t + 0.011, y0 + Hs / 2, 0, safe); // red felt lining
    box(Dp + 0.02, 0.04, W + 0.02, this.mat.brass, 0, y0 + Hs + 0.02, 0, safe);
    this.contactShadow(sx, sz, 1.4, 1.5);

    // door, hinged on the north edge so it swings toward the room
    const pivot = group(Dp / 2, y0 + Hs / 2, -W / 2, safe);
    this.safeDoor = pivot;
    const door = group(0, 0, 0, pivot);
    box(0.06, Hs, W, this.mat.safeGreen, 0.03, 0, W / 2, door);
    box(0.012, Hs - 0.1, W - 0.1, this.mat.darkBrass, 0.066, 0, W / 2, door);
    box(0.014, Hs - 0.16, W - 0.16, this.mat.safeGreen, 0.072, 0, W / 2, door);
    for (const zz of [0.08, W / 2, W - 0.08]) cyl(0.03, 0.03, 0.03, this.mat.darkBrass, 0.07, 0, zz, door).rotation.z = Math.PI / 2;
    texturedPlane(0.4, 0.08, T.toTexture(T.plaque('HOLLIS & CO.', { font: 'bold 60px Georgia, serif' })), door, {
      x: 0.081,
      y: 0.42,
      z: W / 2,
      ry: Math.PI / 2,
      metalness: 0.6,
      roughness: 0.35,
    });
    // handle wheel
    const wheel = group(0.09, -0.22, W / 2, door);
    const torus = mesh(new THREE.TorusGeometry(0.11, 0.014, 8, 28), this.mat.brass, 0, 0, 0, wheel);
    torus.rotation.y = Math.PI / 2;
    for (let k = 0; k < 3; k++) {
      const spoke = box(0.012, 0.22, 0.012, this.mat.brass, 0, 0, 0, wheel);
      spoke.rotation.x = (k * Math.PI) / 3;
    }
    this.interactive(door, { id: 'safe-door', room, kind: 'local', label: 'Iron safe' });

    this.dials = [];
    for (let i = 0; i < SAFE_DIALS; i++) {
      const dz = W / 2 + (i - 1) * 0.26;
      const dial = group(0.08, 0.15, dz, door);
      cyl(0.1, 0.1, 0.035, this.mat.darkBrass, 0, 0, 0, dial).rotation.z = Math.PI / 2;
      const faceMat = std(0xffffff, { map: this.tex.dial[0], metalness: 0.4, roughness: 0.4 });
      const face = mesh(new THREE.CircleGeometry(0.088, 32), faceMat, 0.019, 0, 0, dial);
      face.rotation.y = Math.PI / 2;
      // pointer notch above the dial
      const notch = mesh(new THREE.ConeGeometry(0.018, 0.03, 3), this.mat.brass, 0.02, 0.13, 0, dial);
      notch.rotation.z = Math.PI;
      this.interactive(dial, { id: 'dial', index: i, room, label: `Safe dial ${i + 1} of 3` });
      this.dials.push({ dial, face, value: -1 });
    }

    // inside the safe: the note
    const noteGroup = group(-0.12, 0.75, 0.18, safe);
    this.noteTex = T.toTexture(T.note('?:??'));
    const noteCard = texturedPlane(0.3, 0.21, this.noteTex, noteGroup, { ry: Math.PI / 2, roughness: 0.9, emissive: true });
    noteCard.material.emissiveIntensity = 0.25;
    box(0.004, 0.21, 0.3, this.mat.paper, -0.004, 0, 0, noteGroup);
    noteGroup.rotation.z = 0.18;
    this.interactive(noteGroup, { id: 'note', room, kind: 'local', label: 'A note from the safe' });
    this.gearSafeSpot = new THREE.Vector3(sx - 0.05, 0.3, sz - 0.18);
    this.safeLight = new THREE.PointLight(0xffd27a, 0, 1.4, 2);
    this.safeLight.position.set(sx + 0.1, 0.7, sz);
    this.scene.add(this.safeLight);

    // portrait above the safe
    texturedPlane(0.62, 0.78, T.toTexture(T.painting('portrait')), this.scene, { x: -5.968, y: 2.05, z: sz, ry: Math.PI / 2, roughness: 0.8 });
    box(0.03, 0.86, 0.7, this.mat.darkBrass, -5.99, 2.05, sz, this.scene);
    const portraitHit = box(0.02, 0.8, 0.64, new THREE.MeshBasicMaterial({ visible: false }), -5.96, 2.05, sz, this.scene);
    this.interactive(portraitHit, { id: 'portrait', room, kind: 'local', label: 'Portrait of Old Hollis' });

    // Bookshelf (west wall, south end)
    const shelfG = group(-5.82, 0, 1.85, this.scene);
    box(0.36, 2.3, 0.04, this.mat.darkWood, 0, 1.15, -0.6, shelfG);
    box(0.36, 2.3, 0.04, this.mat.darkWood, 0, 1.15, 0.6, shelfG);
    box(0.03, 2.3, 1.2, this.mat.darkWood, -0.16, 1.15, 0, shelfG);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const bookColors = [0x6d1f1f, 0x1f3f6d, 0x2f5a2f, 0x7a5a1f, 0x4a2a5a, 0x2a2a2a, 0x8c6b3f];
    for (let s = 0; s < 5; s++) {
      const y = 0.08 + s * 0.46;
      box(0.36, 0.03, 1.2, this.mat.darkWood, 0, y, 0, shelfG);
      let zz = -0.56;
      while (zz < 0.5) {
        const w = 0.035 + rnd() * 0.04;
        const h = 0.26 + rnd() * 0.12;
        const b = box(0.24, h, w, std(bookColors[Math.floor(rnd() * bookColors.length)], { roughness: 0.8 }), -0.02, y + 0.015 + h / 2, zz + w / 2, shelfG);
        if (rnd() > 0.92) b.rotation.x = 0.2;
        zz += w + 0.004;
      }
    }
    this.interactive(shelfG, { id: 'bookshelf', room, kind: 'local', label: 'Bookshelf' });
    this.contactShadow(-5.75, 1.85, 0.8, 1.6);

    // Fireplace (south wall)
    const fp = group(cx, 0, D - 0.2, this.scene);
    for (const x of [-0.6625, 0.6625]) box(0.375, 1.15, 0.36, this.mat.stone, x, 0.575, 0, fp);
    box(0.95, 0.4, 0.36, this.mat.stone, 0, 0.95, 0, fp);
    box(0.95, 0.75, 0.05, this.mat.soot, 0, 0.375, 0.15, fp);
    box(0.95, 0.02, 0.36, this.mat.soot, 0, 0.01, 0, fp);
    box(1.95, 0.08, 0.5, this.mat.darkWood, 0, 1.19, -0.04, fp);
    box(1.2, 0.04, 0.45, this.mat.stone, 0, 0.02, -0.38, fp);
    for (const x of [-0.18, 0.12]) {
      const log = cyl(0.06, 0.06, 0.6, std(0x3a2414), x, 0.08, 0.02, fp, 10);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = x * 2;
    }
    this.flames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const [x, s] of [[-0.12, 1], [0.08, 0.8], [0.22, 0.6], [-0.26, 0.55]]) {
      const f = mesh(new THREE.ConeGeometry(0.08 * s, 0.35 * s, 10), flameMat, x, 0.3, 0.0, fp);
      f.userData.base = 0.35 * s;
      f.userData.noHit = true;
      this.flames.push(f);
    }
    this.fireGlow = this.glowSprite(0xff7a2a, 1.4, fp, 0, 0.35, -0.25);
    this.fireGlow.material.opacity = 0.7;
    // candles + a little figure on the mantel
    for (const x of [-0.75, 0.75]) {
      cyl(0.025, 0.025, 0.18, std(0xf2ead8), x, 1.32, -0.05, fp, 10);
      this.glowSprite(0xffb050, 0.18, fp, x, 1.45, -0.05).material.opacity = 0.9;
    }
    texturedPlane(0.7, 0.85, T.toTexture(T.painting('landscape')), fp, { y: 1.85, z: 0.172, ry: Math.PI, roughness: 0.8 });
    box(0.78, 0.93, 0.03, this.mat.darkBrass, 0, 1.85, 0.195, fp);
    this.interactive(fp, { id: 'fireplace', room, kind: 'local', label: 'Fireplace' });

    // Armchair
    const chair = group(cx - 1.55, 0, 1.75, this.scene);
    chair.rotation.y = Math.PI * 0.8;
    box(0.75, 0.2, 0.7, this.mat.leather, 0, 0.42, 0, chair);
    box(0.75, 0.7, 0.16, this.mat.leather, 0, 0.8, -0.32, chair);
    box(0.13, 0.32, 0.7, this.mat.leather, -0.37, 0.58, 0, chair);
    box(0.13, 0.32, 0.7, this.mat.leather, 0.37, 0.58, 0, chair);
    for (const [x, z] of [[-0.32, -0.28], [0.32, -0.28], [-0.32, 0.28], [0.32, 0.28]]) cyl(0.03, 0.025, 0.32, this.mat.darkWood, x, 0.16, z, chair, 8);
    this.interactive(chair, { id: 'armchair', room, kind: 'local', label: 'Armchair' });
    this.contactShadow(cx - 1.55, 1.75, 1.2, 1.2);
  }

  // ---------- the Workshop ----------

  buildWorkshop() {
    const cx = SHOP.cx;
    const room = 'workshop';

    // Workbench + colour panel (north wall)
    const bench = group(cx, 0, -2.6, this.scene);
    box(2.1, 0.08, 0.72, this.mat.lightWood, 0, 0.9, 0, bench);
    for (const [x, z] of [[-0.98, -0.3], [0.98, -0.3], [-0.98, 0.3], [0.98, 0.3]]) box(0.08, 0.86, 0.08, this.mat.wood, x, 0.43, z, bench);
    box(2.0, 0.05, 0.6, this.mat.wood, 0, 0.25, 0, bench);
    // vice, hammer, and some steel cogs (decoration)
    box(0.18, 0.12, 0.12, this.mat.iron, -0.85, 1.0, 0.25, bench);
    box(0.04, 0.04, 0.3, this.mat.steel, -0.85, 1.0, 0.43, bench);
    const hammer = group(0.55, 0.96, 0.15, bench);
    box(0.32, 0.03, 0.03, this.mat.wood, 0, 0, 0, hammer);
    box(0.04, 0.05, 0.11, this.mat.iron, 0.16, 0.005, 0, hammer);
    hammer.rotation.y = 0.5;
    const cogGeo = gearGeometry(0.07, 9, 0.02);
    for (const [x, z, r] of [[-0.35, 0.2, 0.06], [-0.18, 0.1, 0.09], [0.85, 0.05, 0.05]]) {
      const cog = mesh(cogGeo, this.mat.steel, x, 0.955, z, bench);
      cog.scale.setScalar(r / 0.07);
      cog.rotation.x = -Math.PI / 2;
    }
    this.interactive(bench, { id: 'workbench', room, kind: 'local', label: 'Workbench' });
    this.contactShadow(cx, -2.6, 2.6, 1.1);

    const panel = group(cx, 1.6, -2.97, this.scene);
    box(1.4, 0.85, 0.05, this.mat.darkWood, 0, 0, 0, panel);
    texturedPlane(1.3, 0.13, T.toTexture(T.plaque('ENTER THE CODE', { w: 1024, font: 'bold 80px Georgia, serif' })), panel, {
      y: 0.33,
      z: 0.027,
      metalness: 0.6,
      roughness: 0.35,
    });
    for (const [x, y] of [[-0.64, -0.38], [0.64, -0.38], [-0.64, 0.38], [0.64, 0.38]]) sphere(0.018, this.mat.brass, x, y, 0.03, panel, 8);
    this.panelBulbs = [];
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 0.17;
      cyl(0.045, 0.045, 0.03, this.mat.darkBrass, x, 0.13, 0.03, panel).rotation.x = Math.PI / 2;
      const bulbMat = std(0x222222, { emissive: 0x000000, emissiveIntensity: 1, roughness: 0.2 });
      const bulb = sphere(0.035, bulbMat, x, 0.13, 0.05, panel);
      bulb.userData.noHighlight = true;
      this.panelBulbs.push(bulb);
    }
    this.buttons = {};
    LAMP_COLORS.forEach((color, i) => {
      const x = -0.48 + i * 0.32;
      const b = group(x, -0.15, 0.025, panel);
      cyl(0.11, 0.11, 0.04, this.mat.brass, 0, 0, 0.02, b).rotation.x = Math.PI / 2;
      const capMat = std(LAMP_HEX[color], { emissive: LAMP_HEX[color], emissiveIntensity: 0.2, roughness: 0.35 });
      const cap = cyl(0.085, 0.09, 0.06, capMat, 0, 0, 0.06, b);
      cap.rotation.x = Math.PI / 2;
      this.interactive(b, { id: 'panel', color, room, label: `${color[0].toUpperCase()}${color.slice(1)} button` });
      this.buttons[color] = cap;
    });

    // Pegboard with tools (flavour)
    const peg = group(cx + 1.75, 1.65, -2.98, this.scene);
    box(0.9, 0.9, 0.03, std(0xb39064), 0, 0, 0, peg);
    for (let i = 0; i < 4; i++) box(0.05, 0.3 + i * 0.05, 0.02, i % 2 ? this.mat.steel : this.mat.wood, -0.3 + i * 0.2, 0.05, 0.03, peg);
    const bigCog = mesh(gearGeometry(0.13, 12, 0.02), this.mat.steel, 0.0, -0.28, 0.03, peg);
    bigCog.scale.setScalar(0.9);
    this.interactive(peg, { id: 'pegboard', room, kind: 'local', label: 'Tool board' });

    // Chalkboard behind a curtain (east wall)
    const cb = group(6 - 0.04, 1.6, 0, this.scene);
    cb.rotation.y = -Math.PI / 2;
    box(2.05, 1.32, 0.05, this.mat.wood, 0, 0, -0.01, cb);
    this.chalkTex = T.toTexture(T.chalkboard([0, 1, 2]));
    const board = texturedPlane(1.9, 1.18, this.chalkTex, cb, { z: 0.02, roughness: 0.95, emissive: true });
    board.material.emissiveIntensity = 0.12;
    box(1.9, 0.04, 0.08, this.mat.wood, 0, -0.63, 0.04, cb);
    this.interactive(board, { id: 'chalkboard', room, kind: 'local', label: 'Chalkboard' });
    cyl(0.02, 0.02, 2.3, this.mat.brass, 0, 0.78, 0.16, cb, 10).rotation.z = Math.PI / 2;
    for (const x of [-1.16, 1.16]) sphere(0.035, this.mat.brass, x, 0.78, 0.16, cb, 10);
    this.curtain = group(0, 0.76, 0.14, cb);
    const cgeo = new THREE.PlaneGeometry(2.2, 1.45, 48, 1);
    const pos = cgeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 14) * 0.03);
    cgeo.computeVertexNormals();
    const curtainMesh = mesh(cgeo, std(0xffffff, { map: T.toTexture(T.velvet(), { repeat: [3, 1] }), roughness: 0.9, side: THREE.DoubleSide }), 0, -0.725, 0, this.curtain);
    this.interactive(curtainMesh, { id: 'curtain', room, kind: 'local', label: 'Velvet curtain' });

    // Grandfather clock (south wall, facing north)
    const clock = group(cx, 0, D - 0.26, this.scene);
    clock.rotation.y = Math.PI;
    box(0.66, 0.45, 0.42, this.mat.darkWood, 0, 0.225, 0, clock);
    box(0.52, 1.05, 0.04, this.mat.darkWood, 0, 0.975, -0.16, clock);
    for (const x of [-0.24, 0.24]) box(0.04, 1.05, 0.36, this.mat.darkWood, x, 0.975, 0, clock);
    for (const x of [-0.22, 0.22]) box(0.08, 1.05, 0.04, this.mat.darkWood, x, 0.975, 0.16, clock);
    box(0.52, 0.12, 0.04, this.mat.darkWood, 0, 1.44, 0.16, clock);
    box(0.52, 0.12, 0.04, this.mat.darkWood, 0, 0.51, 0.16, clock);
    box(0.66, 0.66, 0.42, this.mat.darkWood, 0, 1.83, 0, clock);
    box(0.72, 0.08, 0.46, this.mat.wood, 0, 2.2, 0, clock);
    sphere(0.05, this.mat.brass, 0, 2.29, 0, clock, 12);
    const face = texturedPlane(0.5, 0.5, T.toTexture(T.clockFace()), clock, { y: 1.83, z: 0.212, roughness: 0.6, emissive: true });
    face.material.emissiveIntensity = 0.12;
    face.geometry = new THREE.CircleGeometry(0.25, 48);
    mesh(new THREE.TorusGeometry(0.255, 0.016, 8, 40), this.mat.brass, 0, 1.83, 0.212, clock);
    this.hourHand = group(0, 1.83, 0.222, clock);
    box(0.032, 0.14, 0.008, this.mat.black, 0, 0.055, 0, this.hourHand);
    this.minuteHand = group(0, 1.83, 0.23, clock);
    box(0.018, 0.21, 0.008, this.mat.black, 0, 0.09, 0, this.minuteHand);
    cyl(0.018, 0.018, 0.02, this.mat.brass, 0, 1.83, 0.235, clock, 12).rotation.x = Math.PI / 2;
    // glass waist with pendulum + an empty axle where the gear belongs
    box(0.44, 1.0, 0.01, std(0x1a120c), 0, 0.975, -0.135, clock);
    this.pendulum = group(0, 1.12, 0.0, clock);
    cyl(0.008, 0.008, 0.45, this.mat.brass, 0, -0.225, 0, this.pendulum, 8);
    cyl(0.07, 0.07, 0.02, this.mat.brass, 0, -0.47, 0, this.pendulum).rotation.x = Math.PI / 2;
    cyl(0.012, 0.012, 0.12, this.mat.steel, 0, 1.26, 0.0, clock, 8).rotation.x = Math.PI / 2;
    this.clockGearSpot = new THREE.Vector3(0, 1.26, 0.07);
    this.clockGroup = clock;
    const glass = mesh(new THREE.PlaneGeometry(0.36, 0.82), this.mat.glass, 0, 0.975, 0.17, clock);
    glass.userData.sharedMaterial = true;
    box(0.4, 0.025, 0.02, this.mat.brass, 0, 1.385, 0.185, clock);
    box(0.4, 0.025, 0.02, this.mat.brass, 0, 0.565, 0.185, clock);
    this.interactive(clock, { id: 'clock', room, label: 'Grandfather clock' });
    this.contactShadow(cx, D - 0.26, 1, 0.8);

    // Hour / minute knobs on the hood
    this.knobs = {};
    for (const [id, x, letter] of [['hour', -0.2, 'H'], ['minute', 0.2, 'M']]) {
      const k = group(x, 1.43, 0.18, clock);
      const knob = cyl(0.05, 0.05, 0.06, this.mat.brass, 0, 0, 0.03, k);
      knob.rotation.x = Math.PI / 2;
      for (let r = 0; r < 6; r++) {
        const ridge = box(0.008, 0.1, 0.06, this.mat.darkBrass, 0, 0, 0.03, k);
        ridge.rotation.z = (r * Math.PI) / 6;
      }
      texturedPlane(0.07, 0.07, T.toTexture(T.plaque(letter, { w: 128, h: 128, font: 'bold 90px Georgia, serif' })), k, {
        y: -0.1,
        z: 0.004,
        metalness: 0.6,
        roughness: 0.35,
      });
      this.interactive(k, { id, room, label: id === 'hour' ? 'Hour knob (H)' : 'Minute knob (M)' });
      this.knobs[id] = knob;
    }

    // Crates + barrel (flavour)
    const crateMat = std(0x8a6a44, { roughness: 0.9 });
    const crates = group(5.3, 0, -2.25, this.scene);
    box(0.7, 0.6, 0.7, crateMat, 0, 0.3, 0, crates);
    box(0.5, 0.45, 0.5, crateMat, 0.05, 0.825, 0.02, crates).rotation.y = 0.3;
    box(0.6, 0.5, 0.6, crateMat, 0, 0.25, 0.75, crates).rotation.y = -0.2;
    this.interactive(crates, { id: 'crates', room, kind: 'local', label: 'Wooden crates' });
    this.contactShadow(5.3, -1.9, 1.3, 1.8);
    cyl(0.3, 0.27, 0.85, std(0x6b4a2a), 5.4, 0.425, 2.3, this.scene);
    for (const y of [0.15, 0.7]) cyl(0.305, 0.305, 0.04, this.mat.iron, 5.4, y, 2.3, this.scene);
    this.contactShadow(5.4, 2.3, 0.8, 0.8);

    // Wall shelf with jars (east wall, north end)
    const js = group(5.85, 1.25, -1.6, this.scene);
    box(0.28, 0.03, 0.9, this.mat.wood, 0, 0, 0, js);
    [0xd9a441, 0x6fa86b, 0x9c5a8a, 0x5a7fb0].forEach((c, i) => {
      cyl(0.06, 0.06, 0.16 + (i % 2) * 0.05, std(c, { transparent: true, opacity: 0.8, roughness: 0.2 }), 0, 0.1, -0.33 + i * 0.22, js, 14);
    });
  }

  // ---------- the gear, the vault, avatars ----------

  buildGear() {
    const g = new THREE.Group();
    const mat = std(0xe0b252, { metalness: 0.9, roughness: 0.25, emissive: 0x6a4a10, emissiveIntensity: 0.4 });
    mesh(gearGeometry(0.13, 12, 0.035), mat, 0, 0, 0, g);
    cyl(0.02, 0.02, 0.06, this.mat.steel, 0, 0, 0, g, 10).rotation.x = Math.PI / 2;
    this.gear = g;
    this.scene.add(g);
    this.interactive(g, { id: 'gear', room: 'study', label: 'Brass gear' });

    // a copy that floats in front of the camera while you're holding it
    this.heldGear = g.clone();
    this.heldGear.userData = {};
    this.heldGear.traverse((m) => (m.userData.noHit = true));
    this.heldGear.position.set(0.32, -0.24, -0.6);
    this.heldGear.rotation.set(0.3, -0.6, 0);
    this.heldGear.visible = false;
    this.world.camera.add(this.heldGear);
    this.gearSpin = 0;
  }

  buildVault() {
    const chest = group(0, -0.9, 0, this.scene);
    this.chest = chest;
    chest.visible = false;
    const wood = std(0x6b3f1f, { roughness: 0.6 });
    box(0.9, 0.45, 0.6, wood, 0, 0.225, 0, chest);
    for (const x of [-0.35, 0.35]) box(0.06, 0.47, 0.62, this.mat.brass, x, 0.225, 0, chest);
    const lid = group(0, 0.45, -0.3, chest);
    const lidMesh = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20, 1, false, 0, Math.PI), wood, 0, 0, 0.3, lid);
    lidMesh.rotation.z = Math.PI / 2;
    for (const x of [-0.35, 0.35]) {
      const band = mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 20, 1, false, 0, Math.PI), this.mat.brass, x, 0, 0.3, lid);
      band.rotation.z = Math.PI / 2;
    }
    this.lid = lid;
    const coins = std(0xffd04a, { metalness: 1, roughness: 0.2, emissive: 0xffa000, emissiveIntensity: 0.6 });
    for (let i = 0; i < 18; i++) cyl(0.04, 0.04, 0.012, coins, (Math.random() - 0.5) * 0.7, 0.43 + Math.random() * 0.06, (Math.random() - 0.5) * 0.4, chest, 12).rotation.x = Math.random();
    this.chestGlow = this.glowSprite(0xffcc55, 2.6, chest, 0, 0.7, 0);
    this.vaultLight = new THREE.PointLight(0xffc04a, 0, 6, 1.5);
    this.vaultLight.position.set(0, 1.2, 0);
    this.scene.add(this.vaultLight);

    // confetti
    const count = 260;
    const conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.05, 0.08), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), count);
    conf.userData.noHit = true;
    conf.frustumCulled = false;
    const palette = [0xe5483f, 0x44c767, 0x3f86ea, 0xf5b630, 0xffffff, 0xc95ad6];
    this.confetti = [];
    for (let i = 0; i < count; i++) {
      conf.setColorAt(i, new THREE.Color(palette[i % palette.length]));
      this.confetti.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), spin: new THREE.Vector3() });
    }
    conf.visible = false;
    this.confettiMesh = conf;
    this.scene.add(conf);
  }

  buildAvatar(color) {
    const g = new THREE.Group();
    const coat = std(color, { roughness: 0.7 });
    const skin = std(0xe9c4a0, { roughness: 0.8 });
    const tweed = std(0x7a6545, { roughness: 0.9 });
    mesh(new THREE.CapsuleGeometry(0.24, 0.6, 6, 16), coat, 0, 0.95, 0, g);
    mesh(new THREE.ConeGeometry(0.36, 0.5, 18, 1, true), coat, 0, 0.55, 0, g);
    const head = group(0, 1.55, 0, g);
    sphere(0.17, skin, 0, 0, 0, head);
    for (const x of [-0.06, 0.06]) sphere(0.022, this.mat.black, x, 0.02, -0.155, head, 8);
    const cap = mesh(new THREE.SphereGeometry(0.185, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), tweed, 0, 0.04, 0, head);
    cap.scale.y = 0.9;
    const brim = cyl(0.12, 0.12, 0.02, tweed, 0, 0.05, -0.17, head, 16);
    brim.scale.set(1, 1, 0.5);
    const back = cyl(0.12, 0.12, 0.02, tweed, 0, 0.05, 0.17, head, 16);
    back.scale.set(1, 1, 0.5);
    sphere(0.025, tweed, 0, 0.21, 0, head, 8);
    const tagTex = T.toTexture(T.nameTag(' '));
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false }));
    tag.scale.set(0.9, 0.225, 1);
    tag.position.y = 2.0;
    g.add(tag);
    g.traverse((m) => (m.userData.noHit = true));
    g.visible = false;
    this.scene.add(g);
    return { group: g, head, tag, name: null, yaw: 0, pitch: 0, goalYaw: 0, goalPitch: 0 };
  }

  setAvatarName(role, name) {
    const a = this.avatars[role];
    if (a.name === name) return;
    a.name = name;
    a.tag.material.map?.dispose();
    a.tag.material.map = T.toTexture(T.nameTag(name || ''));
    a.tag.material.needsUpdate = true;
  }

  setPartnerLook(role, yaw, pitch) {
    const a = this.avatars[role];
    if (!a) return;
    a.goalYaw = yaw;
    a.goalPitch = pitch;
  }

  // ---------- state → props ----------

  setView(viewRoom, myRole) {
    this.viewRoom = viewRoom;
    this.myRole = myRole;
    if (this.state) this.placeGear(this.state.gear);
    this.refreshAvatars();
  }

  refreshAvatars() {
    const s = this.state;
    for (const role of ['study', 'workshop']) {
      const a = this.avatars[role];
      const holder = s?.roles?.[role];
      a.group.visible = !!holder && role !== this.viewRoom;
      if (holder) this.setAvatarName(role, holder.name);
      a.group.position.set(VIEWPOINTS[role].pos.x, 0, VIEWPOINTS[role].pos.z);
    }
  }

  apply(state) {
    const prev = this.state;
    const newRound = !prev || prev.round !== state.round;
    this.state = state;
    const si = stageIndex(state.stage);

    if (newRound || prev.safe.target.join() !== state.safe.target.join()) {
      const img = T.chalkboard(state.safe.target);
      this.chalkTex.image = img;
      this.chalkTex.needsUpdate = true;
      this.chalkImage = img;
    }
    const timeText = formatTime(state.clock.target.h, state.clock.target.m);
    if (newRound || this.noteText !== timeText) {
      const img = T.note(timeText);
      this.noteTex.image = img;
      this.noteTex.needsUpdate = true;
      this.noteImage = img;
      this.noteText = timeText;
    }

    state.safe.dials.forEach((v, i) => {
      const d = this.dials[i];
      if (d.value === v) return;
      d.value = v;
      d.face.material.map = this.tex.dial[v];
      d.face.material.needsUpdate = true;
    });

    this.goal.safeDoor = state.safe.open ? 1 : 0;
    this.goal.curtain = si >= stageIndex('safe') ? 1 : 0;
    this.goal.study = state.levers.study ? 1 : 0;
    this.goal.workshop = state.levers.workshop ? 1 : 0;
    this.goal.divider = state.stage === 'won' ? 1 : 0;
    this.safeLight.intensity = state.safe.open ? 1.2 : 0;

    // clock hands always move forward to their new time
    const hourAngle = (((state.clock.h % 12) + state.clock.m / 60) / 12) * Math.PI * 2;
    const minuteAngle = (state.clock.m / 60) * Math.PI * 2;
    const forward = (cur, target) => cur + ((((target - cur) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
    this.handGoal.hour = newRound ? hourAngle : forward(this.handGoal.hour, hourAngle);
    this.handGoal.minute = newRound ? minuteAngle : forward(this.handGoal.minute, minuteAngle);

    for (const role of ['study', 'workshop']) {
      const lever = this.levers[role];
      const live = state.stage === 'levers' || state.stage === 'won';
      lever.bulb.material.emissive.set(live ? 0x33ff66 : 0xff2a1a);
      lever.bulb.material.color.set(live ? 0x0a3a14 : 0x440000);
      lever.bulbGlow.material.color.set(live ? 0x33ff66 : 0xff3b2a);
    }

    this.placeGear(state.gear);

    if (newRound) {
      Object.assign(this.anim, this.goal);
      this.hands.hour = this.handGoal.hour;
      this.hands.minute = this.handGoal.minute;
      this.chest.visible = state.stage === 'won';
      this.confettiOn = false;
      this.confettiMesh.visible = false;
      this.flash = null;
      this.anim.chest = 0;
      this.anim.lid = 0;
    }
    this.refreshAvatars();
  }

  placeGear(where) {
    const g = this.gear;
    const s = this.state;
    g.visible = true;
    g.rotation.set(0, 0, 0);
    if (g.parent !== this.scene) this.scene.add(g);
    switch (where) {
      case 'safe':
        g.position.copy(this.gearSafeSpot);
        g.rotation.y = Math.PI / 2;
        g.userData.interact.room = 'study';
        break;
      case 'study-tube':
      case 'workshop-tube': {
        const side = where.split('-')[0];
        g.position.copy(this.tubes[side].slot);
        g.rotation.y = Math.PI / 2;
        g.userData.interact.room = side;
        break;
      }
      case 'clock':
        this.clockGroup.add(g);
        g.position.copy(this.clockGearSpot);
        g.userData.interact.room = 'workshop';
        break;
      default:
        g.visible = false; // in someone's hand, or inside the tube
    }
    this.heldGear.visible = !!s && where === `${this.myRole}-hand`;
  }

  // ---------- transient effects ----------

  fx(msg) {
    const t = this.time;
    switch (msg.fx) {
      case 'flash':
        this.flash = { seq: msg.sequence, start: t, last: -1 };
        break;
      case 'press':
        this.pressed[msg.color] = t;
        break;
      case 'buzz':
        this.buzzUntil = t + 0.9;
        break;
      case 'whoosh':
        this.tubeGlow = t;
        break;
      case 'win':
        this.startConfetti();
        break;
    }
  }

  startConfetti() {
    this.confettiOn = true;
    this.confettiStart = this.time;
    this.confettiMesh.visible = true;
    for (const c of this.confetti) {
      c.p.set((Math.random() - 0.5) * 0.4, 0.6, (Math.random() - 0.5) * 0.3);
      c.v.set((Math.random() - 0.5) * 3, 4 + Math.random() * 3.5, (Math.random() - 0.5) * 3);
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.spin.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      c.delay = 3 + Math.random() * 1.2;
    }
  }

  // ---------- per-frame ----------

  update(dt, t) {
    this.time = t;
    const ease = (k) => 1 - Math.exp(-dt * k);
    const a = this.anim;
    const g = this.goal;
    a.safeDoor += (g.safeDoor - a.safeDoor) * ease(2.5);
    a.curtain += (g.curtain - a.curtain) * ease(1.5);
    a.study += (g.study - a.study) * ease(10);
    a.workshop += (g.workshop - a.workshop) * ease(10);
    a.divider += (g.divider - a.divider) * ease(0.9);

    this.safeDoor.rotation.y = a.safeDoor * 1.95;
    this.curtain.scale.y = 1 - a.curtain * 0.93;
    this.levers.study.pivot.rotation.z = 0.35 + a.study * 1.9;
    this.levers.workshop.pivot.rotation.z = -(0.35 + a.workshop * 1.9);
    this.divider.position.y = -a.divider * (H + 0.2);
    this.divider.visible = a.divider < 0.995;

    // Vault chest rises once the wall is mostly down.
    if (this.goal.divider === 1) {
      this.chest.visible = true;
      const rise = THREE.MathUtils.clamp((a.divider - 0.55) / 0.35, 0, 1);
      a.chest += (rise - a.chest) * ease(4);
      this.chest.position.y = -0.9 + a.chest * 0.9;
      a.lid += ((a.chest > 0.95 ? 1 : 0) - a.lid) * ease(2);
      this.lid.rotation.x = -a.lid * 1.9;
      this.chestGlow.material.opacity = a.lid * 0.9;
      this.vaultLight.intensity = a.lid * 6;
    } else {
      this.chest.visible = false;
      this.vaultLight.intensity = 0;
    }

    // Clock hands + pendulum
    this.hands.hour += (this.handGoal.hour - this.hands.hour) * ease(6);
    this.hands.minute += (this.handGoal.minute - this.hands.minute) * ease(6);
    this.hourHand.rotation.z = -this.hands.hour;
    this.minuteHand.rotation.z = -this.hands.minute;
    const running = this.state?.gear === 'clock';
    this.pendulum.rotation.z = running ? Math.sin(t * Math.PI) * 0.18 : this.pendulum.rotation.z * 0.95;
    if (running) {
      this.gear.rotation.z = Math.floor(t) * 0.25 + Math.min(1, (t % 1) * 6) * 0.25;
    }

    // Lamps: idle, flashing a sequence, or steady once solved
    const solved = this.state && this.state.stage !== 'lamps';
    let lit = null;
    if (this.flash) {
      const elapsed = t - this.flash.start;
      const step = Math.floor(elapsed / LAMP_STEP);
      if (step >= this.flash.seq.length) this.flash = null;
      else if (elapsed - step * LAMP_STEP < LAMP_ON) {
        lit = this.flash.seq[step];
        if (step !== this.flash.last) {
          this.flash.last = step;
          if (this.viewRoom === 'study') sfx.lamp(lit);
        }
      }
    }
    for (const color of LAMP_COLORS) {
      const L = this.lamps[color];
      const goal = lit === color ? 1 : solved ? 0.35 : 0.04;
      L.level += (goal - L.level) * ease(lit === color ? 30 : 12);
      // Keep lit lamps saturated: too much emission tone-maps to white and hides the colour.
      L.globe.material.emissiveIntensity = 0.05 + L.level * 1.1;
      L.glow.material.opacity = L.level * 0.85;
    }

    // Panel progress bulbs
    const input = this.state?.lamp.input || [];
    const buzzing = t < this.buzzUntil;
    this.panelBulbs.forEach((b, i) => {
      let color = 0x000000;
      if (buzzing) color = Math.floor(t * 8) % 2 ? 0xff2020 : 0x000000;
      else if (solved) color = 0x33ff66;
      else if (input[i]) color = LAMP_HEX[input[i]];
      b.material.emissive.setHex(color);
      b.material.emissiveIntensity = color ? 1.6 : 0;
    });
    for (const color of LAMP_COLORS) {
      const since = t - (this.pressed[color] ?? -10);
      this.buttons[color].position.z = 0.06 - (since < 0.15 ? 0.025 : 0);
    }

    // Tube glows while something's in flight
    const tubeT = t - (this.tubeGlow || -10);
    const tubeLevel = tubeT < 1.4 ? Math.sin((tubeT / 1.4) * Math.PI) : 0;
    for (const side of ['study', 'workshop']) this.tubes[side].glow.material.opacity = tubeLevel * 0.9;

    // Fire flicker
    const flick = 0.8 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.1 + Math.random() * 0.06;
    this.fireLight.intensity = 6 * flick;
    this.fireGlow.material.opacity = 0.55 * flick;
    this.flames.forEach((f, i) => {
      f.scale.y = 0.85 + Math.sin(t * (9 + i * 2.3) + i) * 0.18;
      f.position.y = 0.2 + (f.userData.base * f.scale.y) / 2;
    });

    // Held item bobs gently
    if (this.heldGear.visible) {
      this.heldGear.rotation.z = t * 0.8;
      this.heldGear.position.y = -0.24 + Math.sin(t * 2) * 0.01;
    }

    // Avatars ease toward the partner's real look direction
    for (const role of ['study', 'workshop']) {
      const av = this.avatars[role];
      av.yaw += (av.goalYaw - av.yaw) * ease(8);
      av.pitch += (av.goalPitch - av.pitch) * ease(8);
      av.group.rotation.y = av.yaw;
      av.head.rotation.x = av.pitch * 0.6;
    }

    if (this.confettiOn) this.updateConfetti(dt, t);
  }

  updateConfetti(dt, t) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const since = t - this.confettiStart;
    this.confetti.forEach((c, i) => {
      if (since < c.delay) {
        m.makeScale(0, 0, 0);
      } else {
        c.v.y -= 6 * dt;
        c.v.multiplyScalar(1 - dt * 0.9);
        if (c.v.y < -1.2) c.v.y = -1.2;
        c.p.addScaledVector(c.v, dt);
        if (c.p.y < 0.02) c.p.y = 0.02;
        c.r.x += c.spin.x * dt;
        c.r.y += c.spin.y * dt;
        q.setFromEuler(c.r);
        m.compose(c.p, q, one);
      }
      this.confettiMesh.setMatrixAt(i, m);
    });
    this.confettiMesh.instanceMatrix.needsUpdate = true;
    if (since > 14) {
      this.confettiOn = false;
      this.confettiMesh.visible = false;
    }
  }

  // World position of a named interactive (used by the debug playtest hooks).
  locate(id, extra = {}) {
    const obj = this.interactives.find((o) => {
      const d = o.userData.interact;
      if (d.id !== id) return false;
      return Object.entries(extra).every(([k, v]) => d[k] === v);
    });
    if (!obj) return null;
    const box3 = new THREE.Box3().setFromObject(obj);
    return box3.getCenter(new THREE.Vector3());
  }
}
