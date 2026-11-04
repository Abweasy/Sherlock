// Renderer, first-person look-around camera, and click/tap picking.
import * as THREE from 'three';

const MIN_FOV = 26;
const MAX_FOV = 72;
const CLICK_SLOP = 8; // px a pointer may move and still count as a click

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0a08);
    this.camera = new THREE.PerspectiveCamera(MAX_FOV, 1, 0.05, 80);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera); // so held items parented to the camera render

    this.yaw = 0;
    this.pitch = -0.08;
    this.targetFov = MAX_FOV - 6;
    this.camera.fov = this.targetFov;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.camera = this.camera;
    this.hovered = null;
    this.onClick = () => {};
    this.onHover = () => {};
    this.canInteract = () => true;
    this.updaters = [];
    this.pointers = new Map();
    this.pinchStart = null;
    this.mouse = null;

    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setViewpoint(position, yaw = 0) {
    this.camera.position.copy(position);
    this.yaw = yaw;
    this.pitch = -0.08;
  }

  zoom(factor) {
    this.targetFov = THREE.MathUtils.clamp(this.targetFov * factor, MIN_FOV, MAX_FOV);
  }

  toggleZoom() {
    this.targetFov = this.targetFov > 45 ? 32 : MAX_FOV - 6;
  }

  // Turn the camera to face a world position (used by the debug playtest hooks).
  lookAt(target) {
    const d = new THREE.Vector3().subVectors(target, this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.applyCamera();
  }

  project(target) {
    this.applyCamera();
    this.camera.updateMatrixWorld();
    const v = target.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  bindInput() {
    const el = this.canvas;
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), fov: this.targetFov };
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.mouse = { x: e.clientX, y: e.clientY };
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 2 && this.pinchStart) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        this.targetFov = THREE.MathUtils.clamp((this.pinchStart.fov * this.pinchStart.dist) / Math.max(dist, 1), MIN_FOV, MAX_FOV);
        return;
      }
      // Drag to look. Slower when zoomed in, so aiming stays precise.
      const speed = (0.0042 * this.camera.fov) / MAX_FOV;
      this.yaw += dx * speed;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * speed, -1.3, 1.3);
    });

    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchStart = null;
      if (!p || e.type === 'pointercancel') return;
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (moved < CLICK_SLOP && performance.now() - p.t < 700) this.click(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => (this.mouse = null));

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(e.deltaY > 0 ? 1.1 : 0.9);
      },
      { passive: false },
    );

    this.keys = new Set();
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.key);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      if (!isVisible(hit.object) || hit.object.userData.noHit) continue;
      // The first solid thing you hit wins, so walls block clicks.
      let o = hit.object;
      while (o && !o.userData.interact) o = o.parent;
      return o && this.canInteract(o.userData.interact) ? o : null;
    }
    return null;
  }

  click(x, y) {
    const target = this.pick(x, y);
    if (target) this.onClick(target.userData.interact, target);
  }

  setHovered(obj) {
    if (obj === this.hovered) return;
    if (this.hovered) highlight(this.hovered, false);
    this.hovered = obj;
    if (obj) highlight(obj, true);
    this.canvas.style.cursor = obj ? 'pointer' : 'grab';
    this.onHover(obj ? obj.userData.interact : null);
  }

  applyCamera() {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    const turn = 1.8 * dt;
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) this.yaw += turn;
    if (this.keys.has('ArrowRight') || this.keys.has('d')) this.yaw -= turn;
    if (this.keys.has('ArrowUp') || this.keys.has('w')) this.pitch = Math.min(1.3, this.pitch + turn * 0.6);
    if (this.keys.has('ArrowDown') || this.keys.has('s')) this.pitch = Math.max(-1.3, this.pitch - turn * 0.6);

    if (Math.abs(this.camera.fov - this.targetFov) > 0.05) {
      this.camera.fov += (this.targetFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
    this.applyCamera();

    for (const fn of this.updaters) fn(dt, t);

    // Hover highlight follows the mouse (touch has no hover). Every 3rd frame is plenty.
    this.frameCount = (this.frameCount || 0) + 1;
    if (this.mouse && this.pointers.size === 0) {
      if (this.frameCount % 3 === 0) this.setHovered(this.pick(this.mouse.x, this.mouse.y));
    }
    else if (this.pointers.size > 0 || !this.mouse) this.setHovered(null);

    this.renderer.render(this.scene, this.camera);
  }
}

function isVisible(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function highlight(obj, on) {
  obj.traverse((m) => {
    if (!m.isMesh || !m.material?.emissive || m.userData.noHighlight) return;
    if (on) {
      m.userData.baseEmissive ??= m.material.emissive.clone();
      m.userData.baseEmissiveIntensity ??= m.material.emissiveIntensity;
      m.material.emissive.set(0x6b4a1a);
      m.material.emissiveIntensity = 0.6;
    } else if (m.userData.baseEmissive) {
      m.material.emissive.copy(m.userData.baseEmissive);
      m.material.emissiveIntensity = m.userData.baseEmissiveIntensity;
    }
  });
}
