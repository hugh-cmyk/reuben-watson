/* ============================================================
   Mech Battle - third-person 3D mech combat (Phase 1, core feel).

   Built with Three.js (vendored locally, no build step). Mobile-first,
   tuned for iPad landscape:
     - Left thumb: virtual joystick (analogue, auto-centres).
     - Right thumb: big SHOOT (hold for continuous fire) and JUMP above it.
     - Desktop test: WASD move, J or click shoot, Space jump, R restart.

   Phase 1 scope: one playable mech, one enemy mech, desert terrain with a
   few rocks and a jumpable platform, follow camera with smoothing and shake,
   dust, momentum, auto-aim assist and a projected enemy health bar.
   Deferred: 5-robot roster, dragons overhead, distant explosions, camera
   collision, dynamic zoom, missiles, boost jump.
   ============================================================ */

import * as THREE from 'three';

/* ---------- Tuning ---------------------------------------- */

const MAX_SPEED = 13;          // mech top speed (units/sec)
const ACCEL = 38;              // how quickly it reaches top speed (heavy feel)
const FRICTION = 10;           // slow-down when the stick is released
const TURN_RATE = 7;           // how fast the mech swings to face its heading
const GRAVITY = 32;
const JUMP_VELOCITY = 13;
const MECH_R = 1.7;            // horizontal collision radius
const BULLET_SPEED = 70;
const PLAYER_FIRE_RATE = 0.16; // seconds between shots
const ENEMY_FIRE_RATE = 0.9;
const CAM_DIST = 12;
const CAM_HEIGHT = 7.0;
const CAM_LOOK_H = 3.2;
const CAM_LOOK_AHEAD = 6;       // look ahead of the mech so it sits centre-bottom

/* ---------- Touch detection (shared with CSS .is-touch) --- */

function detectTouch() {
  return ('ontouchstart' in window) ||
         (navigator.maxTouchPoints > 0) ||
         (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches);
}
let touchMode = detectTouch();
function applyTouchMode() {
  if (document.body) document.body.classList.toggle('is-touch', touchMode);
}
applyTouchMode();

/* ---------- Small helpers --------------------------------- */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}
// Gentle rolling dunes. Used for both the visible terrain and ground sampling.
function terrainHeight(x, z) {
  return Math.sin(x * 0.045) * 1.4 +
         Math.cos(z * 0.05) * 1.4 +
         Math.sin((x + z) * 0.02) * 1.8;
}

/* ---------- Scene state ----------------------------------- */

let renderer, scene, camera, clock;
let player, enemy;
const obstacles = [];          // { kind:'cyl'|'box', ... }
const platforms = [];          // { minX,maxX,minZ,maxZ,topY }

let state = 'start';           // 'start' | 'battle' | 'gameover'
let camYaw = 0;
let camRoll = 0;
let camBobT = 0;

const input = { x: 0, y: 0 };  // joystick / WASD vector, magnitude 0..1
let shooting = false;
let jumpQueued = false;
const keys = {};

// Pools
let bullets = [];
let particles = [];
let circleTex;
const MAX_PARTICLES = touchMode ? 70 : 140;

// DOM
const dom = {};
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/* ---------- Build a mech ---------------------------------- */
/* Returns a state object with its Three.Group and gameplay fields. The two
   mechs use different palettes and a couple of silhouette tweaks so they read
   apart instantly. */

function makeMech(opts) {
  const body = new THREE.MeshLambertMaterial({ color: opts.body });
  const dark = new THREE.MeshLambertMaterial({ color: opts.dark });
  const accent = new THREE.MeshLambertMaterial({ color: opts.accent, emissive: opts.accent, emissiveIntensity: 0.6 });

  const g = new THREE.Group();
  function box(w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }

  // Legs + feet
  box(0.8, 1.9, 0.95, -0.62, 0.95, 0, dark);
  box(0.8, 1.9, 0.95, 0.62, 0.95, 0, dark);
  box(1.0, 0.4, 1.3, -0.62, 0.2, 0.15, body);
  box(1.0, 0.4, 1.3, 0.62, 0.2, 0.15, body);
  // Hips + torso
  box(2.0, 0.7, 1.3, 0, 2.1, 0, dark);
  const torso = box(2.4, 1.8, 1.6, 0, 3.2, 0, body);
  torso.scale.set(opts.bulk, 1, 1);
  // Chest light
  box(0.9, 0.7, 0.2, 0, 3.2, 0.85, accent);
  // Shoulder pods
  box(0.9, 0.9, 1.1, -1.5 * opts.bulk, 3.7, 0, body);
  box(0.9, 0.9, 1.1, 1.5 * opts.bulk, 3.7, 0, body);
  // Cockpit / head, set forward (+Z)
  box(1.1, 0.8, 1.0, 0, 4.25, 0.35, dark);
  box(0.7, 0.25, 0.1, 0, 4.3, 0.86, accent);   // visor
  // Gun arm on the right, pointing forward
  box(0.5, 0.5, 2.2, 1.5 * opts.bulk, 3.2, 1.0, dark);
  const muzzle = box(0.34, 0.34, 0.5, 1.5 * opts.bulk, 3.2, 2.2, accent);
  // Distinguishing marker on the head
  if (opts.fin) {
    box(0.18, 1.0, 0.8, 0, 4.9, 0.2, accent);  // tall fin (enemy)
  } else {
    box(0.16, 0.5, 0.16, 0, 4.85, 0.35, accent); // small antenna (player)
  }

  scene.add(g);

  // Soft blob shadow under the mech
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  return {
    group: g, shadow, muzzleLocal: muzzle.position.clone(),
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, vy: 0, grounded: true,
    maxHealth: opts.health, health: opts.health,
    fireTimer: 0, hitFlash: 0, alive: true, name: opts.name,
    bodyMat: body, baseColor: new THREE.Color(opts.body),
  };
}

/* ---------- World ----------------------------------------- */

function buildWorld() {
  // Sky + haze
  scene.background = new THREE.Color(0xe8a866);
  scene.fog = new THREE.Fog(0xe8a866, 60, 240);

  // Lights
  scene.add(new THREE.HemisphereLight(0xffe9c4, 0x6b4a2b, 1.05));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.15);
  sun.position.set(40, 80, 20);
  scene.add(sun);

  // Terrain
  const SIZE = 320, SEG = 96;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), zp = pos.getY(i);    // planar coords
    pos.setXYZ(i, x, terrainHeight(x, zp), zp);  // lift into XZ with height
  }
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xc8884a }));
  scene.add(ground);

  // Rock formations (also act as forgiving cylinder obstacles)
  for (let i = 0; i < 9; i++) {
    const a = rand(0, Math.PI * 2);
    const d = rand(16, 90);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const r = rand(2.2, 5.5);
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 0),
      new THREE.MeshLambertMaterial({ color: 0x9c6a3c, flatShading: true })
    );
    rock.position.set(x, terrainHeight(x, z) + r * 0.45, z);
    rock.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    scene.add(rock);
    obstacles.push({ kind: 'cyl', x, z, r: r * 0.8 });
  }

  // A couple of mesas you can jump onto
  addPlatform(-24, 18, 11, 9, 5.5);
  addPlatform(30, -22, 9, 8, 4.0);
}

function addPlatform(x, z, w, d, h) {
  const base = terrainHeight(x, z);
  const topY = base + h;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h + 4, d),
    new THREE.MeshLambertMaterial({ color: 0x7d5a3a, flatShading: true })
  );
  mesh.position.set(x, topY - (h + 4) / 2, z);
  scene.add(mesh);
  // A neon rim so the edge reads clearly
  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.2, 0.25, d + 0.2),
    new THREE.MeshBasicMaterial({ color: 0x2ff3ff })
  );
  rim.position.set(x, topY + 0.12, z);
  scene.add(rim);
  platforms.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, topY });
}

/* Ground height under a point, including platform tops once you are high
   enough to stand on them. */
function groundHeightAt(x, z, curY) {
  let gh = terrainHeight(x, z);
  for (const p of platforms) {
    if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ && curY >= p.topY - 0.7) {
      if (p.topY > gh) gh = p.topY;
    }
  }
  return gh;
}

/* Push a mech out of obstacles so it slides along them instead of sticking. */
function resolveObstacles(p, curY) {
  for (const o of obstacles) {
    const dx = p.x - o.x, dz = p.z - o.z;
    const d = Math.hypot(dx, dz);
    const minD = o.r + MECH_R;
    if (d < minD && d > 0.0001) {
      const push = minD - d;
      p.x += (dx / d) * push;
      p.z += (dz / d) * push;
    }
  }
  for (const pf of platforms) {
    if (curY >= pf.topY - 0.7) continue;          // standing on top, no side block
    const exMinX = pf.minX - MECH_R, exMaxX = pf.maxX + MECH_R;
    const exMinZ = pf.minZ - MECH_R, exMaxZ = pf.maxZ + MECH_R;
    if (p.x > exMinX && p.x < exMaxX && p.z > exMinZ && p.z < exMaxZ) {
      // Push out along the axis of least penetration (a glancing slide).
      const penL = p.x - exMinX, penR = exMaxX - p.x;
      const penD = p.z - exMinZ, penU = exMaxZ - p.z;
      const minPen = Math.min(penL, penR, penD, penU);
      if (minPen === penL) p.x = exMinX;
      else if (minPen === penR) p.x = exMaxX;
      else if (minPen === penD) p.z = exMinZ;
      else p.z = exMaxZ;
    }
  }
}

/* ---------- Bullets + particles --------------------------- */

function makeCircleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function spawnBullet(fromPos, dir, owner, color) {
  let b = bullets.find(x => !x.active);
  if (!b) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 8, 8),
      new THREE.MeshBasicMaterial({ color })
    );
    scene.add(mesh);
    b = { mesh, active: false };
    bullets.push(b);
  }
  b.mesh.material.color.set(color);
  b.mesh.position.copy(fromPos);
  b.mesh.visible = true;
  b.active = true;
  b.owner = owner;
  b.life = 1.6;
  b.vel = dir.clone().normalize().multiplyScalar(BULLET_SPEED);
}

function spawnParticles(pos, color, count, speed, opts) {
  opts = opts || {};
  for (let i = 0; i < count; i++) {
    if (particles.filter(p => p.active).length >= MAX_PARTICLES) break;
    let p = particles.find(x => !x.active);
    if (!p) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: circleTex, transparent: true, depthWrite: false,
        blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }));
      scene.add(sprite);
      p = { sprite, active: false };
      particles.push(p);
    }
    p.sprite.material.color.set(color);
    p.sprite.material.blending = opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.sprite.position.copy(pos);
    p.sprite.visible = true;
    p.active = true;
    p.life = p.maxLife = rand(0.3, 0.6);
    p.grow = opts.grow || 3;
    const a = rand(0, Math.PI * 2);
    const up = opts.up || 1;
    p.vel = new THREE.Vector3(Math.cos(a) * rand(0.3, 1) * speed, rand(0.2, 1) * speed * up, Math.sin(a) * rand(0.3, 1) * speed);
    p.size = rand(0.6, 1.2);
  }
}

function spawnExplosion(pos) {
  spawnParticles(pos, 0xffd27a, 22, 9, { additive: true, up: 1.2, grow: 5 });
  spawnParticles(pos, 0xff6a3d, 14, 6, { additive: true, up: 1.0, grow: 4 });
}

function updateBullets(dt) {
  for (const b of bullets) {
    if (!b.active) continue;
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    const target = b.owner === 'player' ? enemy : player;
    if (target.alive) {
      tmp.copy(target.pos); tmp.y += 3.0;          // aim at the chest
      if (b.mesh.position.distanceTo(tmp) < 2.4) {
        damage(target, b.owner === 'player' ? 9 : 6);
        spawnParticles(b.mesh.position, 0xffe2a8, 8, 5, { additive: true });
        b.active = false; b.mesh.visible = false;
        continue;
      }
    }
    if (b.life <= 0 || b.mesh.position.y < terrainHeight(b.mesh.position.x, b.mesh.position.z) - 0.5) {
      b.active = false; b.mesh.visible = false;
    }
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) { p.active = false; p.sprite.visible = false; continue; }
    p.vel.y -= 6 * dt;
    p.sprite.position.addScaledVector(p.vel, dt);
    const k = p.life / p.maxLife;
    const s = p.size * (1 + (1 - k) * p.grow);
    p.sprite.scale.set(s, s, s);
    p.sprite.material.opacity = k;
  }
}

/* ---------- Damage / death -------------------------------- */

function damage(mech, amount) {
  if (!mech.alive) return;
  mech.health = Math.max(0, mech.health - amount);
  mech.hitFlash = 0.12;
  if (mech.health <= 0) {
    mech.alive = false;
    mech.group.visible = false;
    mech.shadow.visible = false;
    tmp.copy(mech.pos); tmp.y += 3;
    spawnExplosion(tmp);
    endBattle(mech === enemy ? 'win' : 'lose');
  }
}

/* ---------- Mech update ----------------------------------- */

function updatePlayer(dt) {
  const p = player;

  // Desired velocity in the camera's horizontal frame (stick up = away,
  // stick right = screen right). cr is the camera's actual right axis.
  const cf = tmp.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  const cr = tmp2.set(-Math.cos(camYaw), 0, Math.sin(camYaw));
  const desX = cf.x * input.y + cr.x * input.x;
  const desZ = cf.z * input.y + cr.z * input.x;
  const desVX = desX * MAX_SPEED;
  const desVZ = desZ * MAX_SPEED;

  const moving = (input.x * input.x + input.y * input.y) > 0.02;
  const rate = moving ? ACCEL : FRICTION;
  p.vel.x += (desVX - p.vel.x) * clamp(rate * dt, 0, 1);
  p.vel.z += (desVZ - p.vel.z) * clamp(rate * dt, 0, 1);

  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  resolveObstacles(p.pos, p.pos.y);

  // Vertical: gravity, jump, ground / platform landing
  if (jumpQueued && p.grounded) { p.vy = JUMP_VELOCITY; p.grounded = false; }
  jumpQueued = false;
  p.vy -= GRAVITY * dt;
  p.pos.y += p.vy * dt;
  const gh = groundHeightAt(p.pos.x, p.pos.z, p.pos.y);
  if (p.pos.y <= gh) { p.pos.y = gh; p.vy = 0; p.grounded = true; } else { p.grounded = false; }

  // Face the heading
  const speed = Math.hypot(p.vel.x, p.vel.z);
  if (speed > 0.6) p.yaw = lerpAngle(p.yaw, Math.atan2(p.vel.x, p.vel.z), TURN_RATE * dt);

  // Dust from the feet while striding on the ground
  if (p.grounded && speed > 3 && Math.random() < speed * dt * 0.25) {
    tmp.copy(p.pos); tmp.x += rand(-0.8, 0.8); tmp.z += rand(-0.8, 0.8); tmp.y += 0.2;
    spawnParticles(tmp, 0xd8a86a, 2, 1.6, { up: 0.6, grow: 4 });
  }

  applyMech(p);

  // Firing with auto-aim assist
  p.fireTimer -= dt;
  if (shooting && p.fireTimer <= 0) {
    p.fireTimer = PLAYER_FIRE_RATE;
    firePlayer();
  }
}

function firePlayer() {
  const muzzle = player.group.localToWorld(player.muzzleLocal.clone());
  // Aim at the enemy if it is roughly ahead, otherwise straight along the camera.
  let dir;
  const cf = tmp.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  if (enemy.alive) {
    tmp2.copy(enemy.pos); tmp2.y += 3;
    const toEnemy = tmp2.clone().sub(muzzle);
    if (toEnemy.clone().normalize().dot(cf) > 0.2 && toEnemy.length() < 160) {
      dir = toEnemy;                 // auto-aim assist
    }
  }
  if (!dir) dir = new THREE.Vector3(cf.x, 0.02, cf.z);
  spawnBullet(muzzle, dir, 'player', 0x9bff5a);
  spawnParticles(muzzle, 0xffe2a8, 4, 4, { additive: true });
}

function updateEnemy(dt) {
  const e = enemy;
  if (!e.alive) { applyMech(e); return; }

  // Move toward the player but hold a fighting distance, with a little strafe.
  tmp.subVectors(player.pos, e.pos); tmp.y = 0;
  const dist = tmp.length();
  tmp.normalize();
  let want;
  if (dist > 26) want = tmp.clone().multiplyScalar(MAX_SPEED * 0.7);
  else if (dist < 16) want = tmp.clone().multiplyScalar(-MAX_SPEED * 0.5);
  else want = new THREE.Vector3(-tmp.z, 0, tmp.x).multiplyScalar(MAX_SPEED * 0.5); // strafe
  e.vel.x += (want.x - e.vel.x) * clamp(ACCEL * 0.7 * dt, 0, 1);
  e.vel.z += (want.z - e.vel.z) * clamp(ACCEL * 0.7 * dt, 0, 1);

  e.pos.x += e.vel.x * dt;
  e.pos.z += e.vel.z * dt;
  resolveObstacles(e.pos, e.pos.y);
  e.pos.y = groundHeightAt(e.pos.x, e.pos.z, e.pos.y);

  // Always face the player
  e.yaw = lerpAngle(e.yaw, Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z), 5 * dt);
  applyMech(e);

  e.fireTimer -= dt;
  if (e.fireTimer <= 0 && dist < 70) {
    e.fireTimer = ENEMY_FIRE_RATE;
    const muzzle = e.group.localToWorld(e.muzzleLocal.clone());
    tmp.copy(player.pos); tmp.y += 3;
    const dir = tmp.clone().sub(muzzle);
    dir.x += rand(-3, 3); dir.y += rand(-1, 2); dir.z += rand(-3, 3);  // a little inaccuracy
    spawnBullet(muzzle, dir, 'enemy', 0xff6a4d);
    spawnParticles(muzzle, 0xffb38a, 3, 4, { additive: true });
  }
}

// Push a mech's simulation state onto its Three.Group + shadow + hit flash.
function applyMech(m) {
  m.group.position.copy(m.pos);
  m.group.rotation.y = m.yaw;
  m.shadow.position.set(m.pos.x, groundHeightAt(m.pos.x, m.pos.z, m.pos.y) + 0.06, m.pos.z);
  m.shadow.visible = m.alive;
  if (m.hitFlash > 0) {
    m.hitFlash -= 0.016;                           // decays roughly each frame
    m.bodyMat.emissive.setRGB(0.6, 0.6, 0.6);
    m.bodyMat.emissiveIntensity = 0.8;
  } else {
    m.bodyMat.emissiveIntensity = 0;
  }
}

/* ---------- Camera ---------------------------------------- */

function updateCamera(dt) {
  if (state === 'start') {
    // Slow idle orbit around the player for the menu backdrop.
    camYaw += dt * 0.25;
    const cf = tmp.set(Math.sin(camYaw), 0, Math.cos(camYaw));
    camera.position.set(
      player.pos.x - cf.x * CAM_DIST, player.pos.y + CAM_HEIGHT, player.pos.z - cf.z * CAM_DIST
    );
    tmp2.set(player.pos.x, player.pos.y + CAM_LOOK_H, player.pos.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(tmp2);
    return;
  }

  const prevYaw = camYaw;
  camYaw = lerpAngle(camYaw, player.yaw, 4 * dt);   // follow with smoothing
  const turn = ((camYaw - prevYaw + Math.PI) % (Math.PI * 2)) - Math.PI;

  const cf = tmp.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  const desired = tmp2.set(
    player.pos.x - cf.x * CAM_DIST,
    player.pos.y + CAM_HEIGHT,
    player.pos.z - cf.z * CAM_DIST
  );
  camera.position.lerp(desired, clamp(6 * dt, 0, 1));

  // Camera shake while walking
  const speed = Math.hypot(player.vel.x, player.vel.z);
  camBobT += dt * 12;
  camera.position.y += Math.sin(camBobT) * 0.06 * (speed / MAX_SPEED);

  // Look ahead of the mech (and a little down), so the mech rides low in frame
  // and the battlefield ahead stays visible instead of being blocked by it.
  const look = new THREE.Vector3(
    player.pos.x + cf.x * CAM_LOOK_AHEAD,
    player.pos.y + CAM_LOOK_H,
    player.pos.z + cf.z * CAM_LOOK_AHEAD
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(look);

  // Slight tilt while turning
  camRoll = clamp(camRoll + (clamp(-turn * 6, -0.12, 0.12) - camRoll) * clamp(8 * dt, 0, 1), -0.12, 0.12);
  camera.rotateZ(camRoll);
}

/* ---------- HUD ------------------------------------------- */

function updateHUD() {
  dom.playerFill.style.width = (player.health / player.maxHealth * 100) + '%';

  // Project the enemy to screen for its marker + health bar.
  if (enemy.alive && state === 'battle') {
    tmp.copy(enemy.pos); tmp.y += 6.2;
    tmp.project(camera);
    if (tmp.z < 1) {
      const x = (tmp.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
      dom.marker.style.display = 'block';
      dom.marker.style.left = x + 'px';
      dom.marker.style.top = y + 'px';
      dom.markerFill.style.width = (enemy.health / enemy.maxHealth * 100) + '%';
    } else {
      dom.marker.style.display = 'none';
    }
  } else {
    dom.marker.style.display = 'none';
  }
}

/* ---------- Battle flow ----------------------------------- */

function resetBattle() {
  player.alive = true; player.group.visible = true; player.health = player.maxHealth;
  player.pos.set(0, terrainHeight(0, 0), 0); player.vel.set(0, 0, 0); player.vy = 0; player.yaw = 0;
  player.fireTimer = 0; player.hitFlash = 0;

  enemy.alive = true; enemy.group.visible = true; enemy.health = enemy.maxHealth;
  enemy.pos.set(0, terrainHeight(0, 28), 28); enemy.vel.set(0, 0, 0); enemy.vy = 0; enemy.yaw = Math.PI;
  enemy.fireTimer = ENEMY_FIRE_RATE;

  bullets.forEach(b => { b.active = false; b.mesh.visible = false; });
  particles.forEach(p => { p.active = false; p.sprite.visible = false; });

  input.x = input.y = 0; shooting = false; jumpQueued = false;
  applyMech(player); applyMech(enemy);
  camYaw = 0;
}

function startBattle() {
  resetBattle();
  state = 'battle';
  dom.start.classList.add('hidden');
  dom.gameover.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  tryLockLandscape();
}

function endBattle(result) {
  state = 'gameover';
  dom.hud.classList.add('hidden');
  dom.resultText.textContent = result === 'win' ? 'Victory' : 'Defeat';
  dom.resultText.className = 'result ' + (result === 'win' ? 'win' : 'lose');
  dom.resultSub.textContent = result === 'win'
    ? 'The rival mech is scrap. Tap Restart to fight again.'
    : 'Your mech is down. Tap Restart to try again.';
  dom.gameover.classList.remove('hidden');
}

function tryLockLandscape() {
  try {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  } catch (e) { /* not supported here */ }
}

/* ---------- Main loop ------------------------------------- */

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state === 'battle') {
    updatePlayer(dt);
    updateEnemy(dt);
    updateBullets(dt);
  } else {
    applyMech(player);
    applyMech(enemy);
  }
  updateParticles(dt);
  updateCamera(dt);
  updateHUD();
  renderer.render(scene, camera);
}

/* ---------- Resize ---------------------------------------- */

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touchMode ? 1.5 : 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ---------- Input ----------------------------------------- */

function bindInput() {
  // Joystick (touch)
  const zone = dom.joystick;
  const baseEl = dom.joystickBase;
  let joyId = null;
  function joyRadius() { return baseEl.offsetWidth * 0.5; }
  function baseCenter() {
    const r = baseEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function setThumb(dx, dy) {
    dom.joystickThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
  zone.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (joyId !== null) return;
    joyId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    moveJoy(e);
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId === joyId) moveJoy(e); });
  ['pointerup', 'pointercancel'].forEach(ev => zone.addEventListener(ev, e => {
    if (e.pointerId !== joyId) return;
    joyId = null; input.x = 0; input.y = 0; setThumb(0, 0);
  }));
  function moveJoy(e) {
    const c = baseCenter();
    let dx = e.clientX - c.x, dy = e.clientY - c.y;
    const r = joyRadius();
    const len = Math.hypot(dx, dy);
    if (len > r) { dx = dx / len * r; dy = dy / len * r; }
    setThumb(dx, dy);
    input.x = dx / r;
    input.y = -dy / r;            // screen y is down, joystick up should be forward
  }

  // Shoot + jump buttons (touch)
  const shootBtn = dom.shootBtn, jumpBtn = dom.jumpBtn;
  shootBtn.addEventListener('pointerdown', e => { e.preventDefault(); shooting = true; shootBtn.classList.add('pressed'); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => shootBtn.addEventListener(ev, () => { shooting = false; shootBtn.classList.remove('pressed'); }));
  jumpBtn.addEventListener('pointerdown', e => { e.preventDefault(); if (state === 'battle') jumpQueued = true; });

  // First real touch turns on touch mode (covers iPads that hide touch points).
  window.addEventListener('touchstart', () => { if (!touchMode) { touchMode = true; applyTouchMode(); onResize(); } }, { capture: true, passive: true });

  // Keyboard (desktop test)
  window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') { e.preventDefault(); if (state === 'battle') jumpQueued = true; }
    if (e.key.toLowerCase() === 'j') shooting = true;
    if (e.key.toLowerCase() === 'r' && state === 'gameover') startBattle();
    updateKeyAxis();
  });
  window.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
    if (e.key.toLowerCase() === 'j') shooting = false;
    updateKeyAxis();
  });
  function updateKeyAxis() {
    if (joyId !== null) return;   // a real joystick drag wins
    let ix = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);
    let iy = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
    const len = Math.hypot(ix, iy) || 1;
    input.x = ix / len * (ix || iy ? 1 : 0);
    input.y = iy / len * (ix || iy ? 1 : 0);
  }

  // Mouse: hold to shoot on desktop
  dom.canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') shooting = true; });
  window.addEventListener('pointerup', e => { if (e.pointerType === 'mouse') shooting = false; });
}

/* ---------- Boot ------------------------------------------ */

function init() {
  dom.canvas = document.getElementById('game');
  dom.hud = document.getElementById('hud');
  dom.start = document.getElementById('start-screen');
  dom.gameover = document.getElementById('gameover-screen');
  dom.resultText = document.getElementById('result-text');
  dom.resultSub = document.getElementById('result-sub');
  dom.playerFill = document.getElementById('player-health-fill');
  dom.joystick = document.getElementById('joystick');
  dom.joystickBase = document.getElementById('joystick-base');
  dom.joystickThumb = document.getElementById('joystick-thumb');
  dom.shootBtn = document.getElementById('shoot-btn');
  dom.jumpBtn = document.getElementById('jump-btn');

  // Enemy marker (built once, repositioned each frame)
  const markers = document.getElementById('markers');
  dom.marker = document.createElement('div');
  dom.marker.className = 'enemy-marker';
  dom.marker.innerHTML = '<div class="chevron">▼</div><div class="ebar"><div class="efill"></div></div><div class="ename">Rival Mech</div>';
  dom.marker.style.display = 'none';
  markers.appendChild(dom.marker);
  dom.markerFill = dom.marker.querySelector('.efill');

  renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: !touchMode, powerPreference: 'high-performance' });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);
  clock = new THREE.Clock();
  circleTex = makeCircleTexture();

  buildWorld();

  player = makeMech({ name: 'Player', body: 0x2ff3ff, dark: 0x2a4a55, accent: 0x9bff5a, health: 100, bulk: 1.0, fin: false });
  enemy = makeMech({ name: 'Rival Mech', body: 0xff6a4d, dark: 0x55262a, accent: 0xffb13d, health: 100, bulk: 1.15, fin: true });

  resetBattle();
  applyTouchMode();
  onResize();
  bindInput();

  document.getElementById('play-btn').addEventListener('click', startBattle);
  document.getElementById('restart-btn').addEventListener('click', startBattle);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  animate();
}

init();
