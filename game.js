/* ============================================================
   Robot & Dragon Battle
   A simple 2D canvas game. No build step, no dependencies.

   Works on desktop, iPad and phones:
     - Desktop: mouse moves the robot, Space fires, Q special, E shield, R restart.
     - Touch:   drag to move, on-screen Fire / Special / Shield buttons, and the
                Restart button on the win/lose screen.

   The "world" is responsive. Instead of a fixed 960x600 grid, the layout is
   recomputed from the live canvas size (VW x VH) so the game fills whatever
   screen it is on without cropping. See resize() and layout().
   ============================================================ */

'use strict';

/* ---------- 1. Config + helpers --------------------------- */

// Live game-world size in CSS pixels. Set by resize(); do not hard-code sizes.
let VW = 960;
let VH = 600;
let SKY_H = 250;                   // height of the sky band, set in layout()
let DPR = 1;                       // device pixel ratio used for crisp rendering
let robotPixelScale = 1;           // scales robots to the screen height

// Movement boxes for each robot (centre point stays inside). Set in layout().
let PLAYER_ZONE = { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
let ENEMY_ZONE  = { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };

// Touch devices (phones, tablets) get on-screen buttons and lighter effects.
// touchMode can also flip on the first real touch: some iPads report no touch
// points until the screen is actually touched, so static detection can miss.
function detectTouch() {
  return ('ontouchstart' in window) ||
         (navigator.maxTouchPoints > 0) ||
         (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches);
}
let touchMode = detectTouch();
let LOW_FX = touchMode;            // fewer particles, no glow blur on touch
let MAX_PARTICLES = touchMode ? 90 : 200;
const MAX_BULLETS = 70;

// Apply the current touch mode. CSS keys off the body's "is-touch" class so the
// layout (fullscreen vs framed) always agrees with whether buttons are shown.
function applyTouchMode() {
  LOW_FX = touchMode;
  MAX_PARTICLES = touchMode ? 90 : 200;
  if (document.body) document.body.classList.toggle('is-touch', touchMode);
}
applyTouchMode();

// Turn on touch mode the first time the screen is actually touched.
function enableTouchMode() {
  if (touchMode) return;
  touchMode = true;
  applyTouchMode();
  if (canvas) resize();                         // relayout for the touch zones
  if (state === 'battle') setTouchControls(true);
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function now() { return performance.now(); }

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function now() { return performance.now(); }

/* ---------- 2. Robot definitions -------------------------- */
/* Each robot has display stats (1..5, shown on the cards) and gameplay
   numbers. "weapon" controls the main fire; "special" is the Q blast. */

const ROBOTS = [
  {
    id: 'scout', name: 'Scout Bot', shape: 'scout',
    color: '#59ff8f', accent: '#d6ffe6',
    tag: 'Fast and fragile. Rapid light laser.',
    maxHealth: 70, moveSpeed: 6.6, scale: 0.85,
    weapon: { count: 1, fireRate: 140, damage: 5, bulletSpeed: 12, bulletSize: 4, spreadDeg: 0 },
    special: { name: 'Burst Coil', cooldown: 4500, damage: 24, bulletSpeed: 14, bulletSize: 12 },
    shield: { cooldown: 5500, duration: 1400 },
    stats: { speed: 5, health: 2, power: 2 },
  },
  {
    id: 'tank', name: 'Tank Bot', shape: 'tank',
    color: '#ffb13d', accent: '#ffe6bf',
    tag: 'Slow but tough. Heavy cannon.',
    maxHealth: 220, moveSpeed: 3.0, scale: 1.15,
    weapon: { count: 1, fireRate: 950, damage: 34, bulletSpeed: 7, bulletSize: 13, spreadDeg: 0 },
    special: { name: 'Siege Shell', cooldown: 6500, damage: 70, bulletSpeed: 8, bulletSize: 20 },
    shield: { cooldown: 6000, duration: 1800 },
    stats: { speed: 1, health: 5, power: 4 },
  },
  {
    id: 'plasma', name: 'Plasma Bot', shape: 'plasma',
    color: '#2ff3ff', accent: '#c9fbff',
    tag: 'Balanced fighter. Plasma burst.',
    maxHealth: 130, moveSpeed: 4.6, scale: 1.0,
    weapon: { count: 1, fireRate: 420, damage: 14, bulletSpeed: 9, bulletSize: 9, spreadDeg: 0 },
    special: { name: 'Plasma Nova', cooldown: 5500, damage: 42, bulletSpeed: 9, bulletSize: 16 },
    shield: { cooldown: 5500, duration: 1600 },
    stats: { speed: 3, health: 3, power: 3 },
  },
  {
    id: 'sniper', name: 'Sniper Bot', shape: 'sniper',
    color: '#ff3df0', accent: '#ffcdf7',
    tag: 'Slow shots that hit very hard.',
    maxHealth: 75, moveSpeed: 4.6, scale: 1.0,
    weapon: { count: 1, fireRate: 1150, damage: 46, bulletSpeed: 16, bulletSize: 5, spreadDeg: 0 },
    special: { name: 'Rail Pierce', cooldown: 6000, damage: 90, bulletSpeed: 20, bulletSize: 8 },
    shield: { cooldown: 6000, duration: 1400 },
    stats: { speed: 3, health: 2, power: 5 },
  },
  {
    id: 'storm', name: 'Storm Bot', shape: 'storm',
    color: '#9a6bff', accent: '#e0d4ff',
    tag: 'Fast mover. Wide spread shot.',
    maxHealth: 120, moveSpeed: 5.8, scale: 0.95,
    weapon: { count: 5, fireRate: 520, damage: 7, bulletSpeed: 10, bulletSize: 5, spreadDeg: 34 },
    special: { name: 'Tempest Fan', cooldown: 5000, damage: 14, bulletSpeed: 11, bulletSize: 9, count: 7, spreadDeg: 60 },
    shield: { cooldown: 5500, duration: 1600 },
    stats: { speed: 4, health: 3, power: 3 },
  },
];

function getRobotDef(id) { return ROBOTS.find(function (r) { return r.id === id; }); }

/* ---------- 3. Game state --------------------------------- */

let canvas, ctx;
let state = 'start';               // 'start' | 'select' | 'battle' | 'gameover'
let result = '';                   // 'win' | 'lose'
let selectedRobotId = null;

let player = null;
let enemy = null;
let playerBullets = [];
let enemyBullets = [];
let particles = [];
let dragons = [];
let fireballs = [];

// Background decoration, rebuilt whenever the canvas resizes.
let stars = [];
let buildings = [];
let gridOffset = 0;

const keys = {};                   // currently held keys, e.g. keys[' ']
const mouse = { x: 200, y: 300, inside: false };  // also used for the touch finger
let lastTime = 0;

const dom = {};                    // DOM references, filled in on load

/* Show one overlay screen and hide the others. Passing null hides them all
   (used during the battle so only the canvas shows). */
function showScreen(name) {
  ['start', 'select', 'gameover'].forEach(function (s) {
    dom[s].classList.toggle('hidden', s !== name);
  });
}

/* Show or hide the on-screen touch buttons (only on touch devices). */
function setTouchControls(on) {
  if (!dom.touch) return;
  dom.touch.classList.toggle('hidden', !(on && touchMode));
}

/* ---------- 3b. Responsive layout ------------------------- */

/* Recompute the sky height, robot scale and movement zones from the current
   canvas size. Called on every resize and orientation change. */
function layout() {
  SKY_H = Math.round(VH * 0.42);
  robotPixelScale = clamp(VH / 600, 0.72, 1.12);

  const groundH = VH - SKY_H;
  const top = SKY_H + groundH * 0.20;
  // On touch we keep the robots in the upper part of the ground so the
  // bottom corners stay free for the Fire / Special buttons.
  const bottom = SKY_H + groundH * (touchMode ? 0.50 : 0.92);

  PLAYER_ZONE = { xMin: VW * 0.06, xMax: VW * 0.42, yMin: top, yMax: bottom };
  ENEMY_ZONE  = { xMin: VW * 0.58, xMax: VW * 0.94, yMin: top, yMax: bottom };
}

/* Match the canvas resolution to its on-screen size (times the pixel ratio for
   sharpness) and rebuild everything that depends on the size. */
function resize() {
  const rect = canvas.getBoundingClientRect();
  VW = Math.max(320, Math.round(rect.width));
  VH = Math.max(240, Math.round(rect.height));
  DPR = Math.min(window.devicePixelRatio || 1, touchMode ? 1.5 : 2);

  canvas.width = Math.round(VW * DPR);
  canvas.height = Math.round(VH * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);   // draw in CSS pixels from here on

  layout();
  rebuildScenery();

  // Keep fighters inside the new zones if the screen changed mid-battle.
  if (player) clampRobotToZone(player, PLAYER_ZONE);
  if (enemy) clampRobotToZone(enemy, ENEMY_ZONE);
  if (!player) { mouse.x = VW * 0.2; mouse.y = (SKY_H + VH) / 2; }

  positionDragons();
}

function clampRobotToZone(r, z) {
  r.x = clamp(r.x, z.xMin, z.xMax);
  r.y = clamp(r.y, z.yMin, z.yMax);
}

/* ---------- 4a. Robot logic ------------------------------- */

function makeRobot(def, side) {
  const isEnemy = side === 'enemy';
  const zone = isEnemy ? ENEMY_ZONE : PLAYER_ZONE;
  const midY = (zone.yMin + zone.yMax) / 2;
  const scale = def.scale * robotPixelScale;

  // The enemy is tuned to be a little easier so the game stays fun and winnable.
  const dmgScale = isEnemy ? 0.75 : 1;
  const rateScale = isEnemy ? 1.2 : 1;

  return {
    def: def,
    side: side,
    facing: isEnemy ? -1 : 1,                 // player faces right, enemy faces left
    x: isEnemy ? zone.xMax - (zone.xMax - zone.xMin) * 0.3 : zone.xMin + (zone.xMax - zone.xMin) * 0.3,
    y: midY,
    scale: scale,
    boxW: 52 * scale,
    boxH: 78 * scale,
    maxHealth: def.maxHealth,
    health: def.maxHealth,
    moveSpeed: def.moveSpeed,
    hitFlash: 0,                              // counts down after taking a hit
    lastShot: 0,
    specialReadyAt: 0,
    shieldReadyAt: 0,
    shieldActive: false,
    shieldUntil: 0,
    weapon: {
      count: def.weapon.count,
      fireRate: def.weapon.fireRate * rateScale,
      damage: def.weapon.damage * dmgScale,
      bulletSpeed: def.weapon.bulletSpeed,
      bulletSize: def.weapon.bulletSize,
      spreadDeg: def.weapon.spreadDeg,
    },
    aiTimer: 0,
    aiTargetX: 0,
    aiTargetY: midY,
  };
}

/* Fire the main weapon (or a special burst) from a robot. */
function fireWeapon(robot, special) {
  const def = robot.def;
  const w = special ? def.special : robot.weapon;
  const count = w.count || 1;
  const spreadDeg = w.spreadDeg || 0;
  const baseAngle = robot.facing === 1 ? 0 : Math.PI;   // straight at the foe
  const muzzleX = robot.x + robot.facing * 30 * robot.scale;
  const muzzleY = robot.y - 6;
  const color = special ? def.accent : def.color;
  const list = robot.side === 'player' ? playerBullets : enemyBullets;

  for (let i = 0; i < count; i++) {
    let angle = baseAngle;
    if (count > 1) {
      const t = (i / (count - 1)) - 0.5;                // -0.5 .. 0.5
      angle += t * (spreadDeg * Math.PI / 180);
    }
    list.push({
      x: muzzleX, y: muzzleY,
      vx: Math.cos(angle) * w.bulletSpeed,
      vy: Math.sin(angle) * w.bulletSpeed,
      size: w.bulletSize,
      damage: w.damage,
      color: color,
      owner: robot.side,
      special: !!special,
    });
  }
  if (list.length > MAX_BULLETS) list.splice(0, list.length - MAX_BULLETS);

  spawnParticles(muzzleX, muzzleY, color, special ? 10 : 4, special ? 3.5 : 2);
}

/* Move a robot toward a target point, limited by its speed. */
function moveToward(robot, tx, ty, speed, dtScale) {
  const dx = tx - robot.x;
  const dy = ty - robot.y;
  const dist = Math.hypot(dx, dy);
  const step = speed * dtScale;
  if (dist > step) {
    robot.x += (dx / dist) * step;
    robot.y += (dy / dist) * step;
  } else {
    robot.x = tx;
    robot.y = ty;
  }
}

/* ---------- 4b. Particles + explosions -------------------- */

function spawnParticles(x, y, color, count, speed) {
  if (LOW_FX) count = Math.max(2, Math.round(count * 0.55));   // lighter on mobile
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(0.3, 1) * speed;
    particles.push({
      x: x, y: y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 1, decay: rand(0.02, 0.05),
      size: rand(2, 4),
      color: color,
    });
  }
  if (particles.length > MAX_PARTICLES) {
    particles.splice(0, particles.length - MAX_PARTICLES);
  }
}

function spawnExplosion(x, y, color) {
  spawnParticles(x, y, color, 26, 6);
  spawnParticles(x, y, '#ffffff', 12, 4);
}

function updateParticles(dtScale) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dtScale;
    p.y += p.vy * dtScale;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life -= p.decay * dtScale;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

/* ---------- 4c. Dragons (sky battle) ---------------------- */
/* The dragons are mostly for show. They roam the sky, flap their wings and
   throw fireballs at each other to make the scene feel alive. */

function positionDragons() {
  if (dragons.length === 0) {
    dragons = [
      { color: '#2ff3ff', dir: 1,  speed: rand(0.6, 0.9), bob: rand(0, 6.28), flap: 0, fireTimer: rand(1500, 3500), x: 0, y: 0, baseY: 0 },
      { color: '#ff3df0', dir: -1, speed: rand(0.6, 0.9), bob: rand(0, 6.28), flap: 0, fireTimer: rand(1500, 3500), x: 0, y: 0, baseY: 0 },
    ];
  }
  dragons[0].baseY = SKY_H * 0.34;
  dragons[1].baseY = SKY_H * 0.6;
  // Keep them on screen after a resize.
  dragons[0].x = clamp(dragons[0].x || VW * 0.25, 60, VW - 60);
  dragons[1].x = clamp(dragons[1].x || VW * 0.75, 60, VW - 60);
}

function updateDragons(dtScale, dtMs) {
  const amp = Math.min(22, SKY_H * 0.12);
  dragons.forEach(function (d) {
    d.x += d.dir * d.speed * dtScale;
    if (d.x < 60) { d.x = 60; d.dir = 1; }
    if (d.x > VW - 60) { d.x = VW - 60; d.dir = -1; }
    d.bob += 0.03 * dtScale;
    d.flap += 0.18 * dtScale;
    d.y = d.baseY + Math.sin(d.bob) * amp;

    d.fireTimer -= dtMs;
    if (d.fireTimer <= 0) {
      const target = dragons.find(function (o) { return o !== d; });
      if (target) {
        const dx = target.x - d.x;
        const dy = target.y - d.y;
        const dist = Math.hypot(dx, dy) || 1;
        const sp = 3.2;
        fireballs.push({
          x: d.x + d.dir * 26, y: d.y,
          vx: (dx / dist) * sp, vy: (dy / dist) * sp,
          color: d.color, life: 1,
        });
        spawnParticles(d.x + d.dir * 26, d.y, d.color, 6, 2);
      }
      // Fewer fireballs on mobile so the sky stays cheap to draw.
      d.fireTimer = rand(LOW_FX ? 2600 : 1800, LOW_FX ? 5200 : 4200);
    }
  });

  for (let i = fireballs.length - 1; i >= 0; i--) {
    const f = fireballs[i];
    f.x += f.vx * dtScale;
    f.y += f.vy * dtScale;
    f.life -= 0.012 * dtScale;
    let hit = false;
    dragons.forEach(function (d) {
      if (Math.hypot(d.x - f.x, d.y - f.y) < 26) hit = true;
    });
    if (hit || f.life <= 0) {
      spawnParticles(f.x, f.y, f.color, 10, 3);
      fireballs.splice(i, 1);
    }
  }
}

/* ---------- 4d. Battle update ----------------------------- */

function updateBattle(dtScale, dtMs) {
  const t = now();

  // Player follows the mouse / finger inside its zone.
  const tx = clamp(mouse.x, PLAYER_ZONE.xMin, PLAYER_ZONE.xMax);
  const ty = clamp(mouse.y, PLAYER_ZONE.yMin, PLAYER_ZONE.yMax);
  moveToward(player, tx, ty, player.moveSpeed, dtScale);

  // Main fire (held spacebar or held Fire button).
  if (keys[' '] && t - player.lastShot >= player.weapon.fireRate) {
    fireWeapon(player, false);
    player.lastShot = t;
  }

  // Shield timer.
  if (player.shieldActive && t >= player.shieldUntil) player.shieldActive = false;

  // Enemy AI: drift toward the player and fire on its own clock.
  enemy.aiTimer -= dtMs;
  if (enemy.aiTimer <= 0) {
    enemy.aiTargetX = rand(ENEMY_ZONE.xMin, ENEMY_ZONE.xMax);
    enemy.aiTargetY = clamp(player.y + rand(-90, 90), ENEMY_ZONE.yMin, ENEMY_ZONE.yMax);
    enemy.aiTimer = rand(700, 1500);
  }
  moveToward(enemy, enemy.aiTargetX, enemy.aiTargetY, enemy.moveSpeed * 0.6, dtScale);
  if (t - enemy.lastShot >= enemy.weapon.fireRate) {
    fireWeapon(enemy, false);
    enemy.lastShot = t;
  }

  updateBullets(playerBullets, dtScale);
  updateBullets(enemyBullets, dtScale);

  resolveHits(playerBullets, enemy, false);     // player shots hit the enemy
  resolveHits(enemyBullets, player, true);       // enemy shots hit the player

  if (player.hitFlash > 0) player.hitFlash -= dtMs;
  if (enemy.hitFlash > 0) enemy.hitFlash -= dtMs;

  if (enemy.health <= 0 && state === 'battle') endBattle('win');
  else if (player.health <= 0 && state === 'battle') endBattle('lose');
}

function updateBullets(list, dtScale) {
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.x += b.vx * dtScale;
    b.y += b.vy * dtScale;
    if (b.x < -30 || b.x > VW + 30 || b.y < -30 || b.y > VH + 30) list.splice(i, 1);
  }
}

function resolveHits(list, target, targetIsPlayer) {
  const halfW = target.boxW / 2;
  const halfH = target.boxH / 2;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    const hit = b.x > target.x - halfW && b.x < target.x + halfW &&
                b.y > target.y - halfH && b.y < target.y + halfH;
    if (!hit) continue;

    if (targetIsPlayer && target.shieldActive) {
      spawnParticles(b.x, b.y, '#2ff3ff', 8, 3);     // shield blocks the shot
    } else {
      target.health = Math.max(0, target.health - b.damage);
      target.hitFlash = 120;
      spawnParticles(b.x, b.y, b.color, b.special ? 16 : 8, b.special ? 4 : 3);
    }
    list.splice(i, 1);
  }
}

function endBattle(outcome) {
  result = outcome;
  state = 'gameover';
  const loser = outcome === 'win' ? enemy : player;
  spawnExplosion(loser.x, loser.y - 10, loser.def.color);

  dom.resultText.textContent = outcome === 'win' ? 'You Win!' : 'You Lose';
  dom.resultText.className = 'result ' + outcome;
  dom.resultSub.textContent = outcome === 'win'
    ? 'Your robot stands tall. Press R or tap Restart to battle again.'
    : 'Your robot is down. Press R or tap Restart to try another fighter.';
  setTouchControls(false);
  showScreen('gameover');
}

/* ---------- 5. Rendering ---------------------------------- */

function rebuildScenery() {
  stars = [];
  const starCount = LOW_FX ? 36 : 70;
  for (let i = 0; i < starCount; i++) {
    stars.push({ x: rand(0, VW), y: rand(0, SKY_H), r: rand(0.5, 1.6), seed: rand(0, 100) });
  }
  buildings = [];
  let bx = 0;
  while (bx < VW) {
    const w = rand(38, 80);
    buildings.push({
      x: bx, w: w,
      h: rand(SKY_H * 0.28, SKY_H * 0.7),
      color: Math.random() < 0.5 ? '#2ff3ff' : '#ff3df0',
    });
    bx += w + rand(6, 22);
  }
}

function drawBackground(dtScale) {
  // Sky gradient.
  let sky = ctx.createLinearGradient(0, 0, 0, SKY_H);
  sky.addColorStop(0, '#070a23');
  sky.addColorStop(1, '#241247');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VW, SKY_H);

  // Twinkling stars.
  const t = now() / 600;
  stars.forEach(function (s) {
    ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(t + s.seed));
    ctx.fillStyle = '#cfe8ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // City skyline silhouettes on the horizon.
  buildings.forEach(function (b) {
    const top = SKY_H - b.h;
    ctx.fillStyle = '#0b0e2e';
    ctx.fillRect(b.x, top, b.w, b.h);
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x, top);
    ctx.lineTo(b.x + b.w, top);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = b.color;
    for (let wy = top + 10; wy < SKY_H - 6; wy += 16) {
      for (let wx = b.x + 6; wx < b.x + b.w - 6; wx += 14) {
        if (Math.random() < 0.12) {
          ctx.globalAlpha = 0.6;
          ctx.fillRect(wx, wy, 4, 6);
        }
      }
    }
    ctx.globalAlpha = 1;
  });

  // Glowing horizon line.
  ctx.strokeStyle = 'rgba(47, 243, 255, 0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, SKY_H);
  ctx.lineTo(VW, SKY_H);
  ctx.stroke();

  // Ground.
  let ground = ctx.createLinearGradient(0, SKY_H, 0, VH);
  ground.addColorStop(0, '#140a2c');
  ground.addColorStop(1, '#060414');
  ctx.fillStyle = ground;
  ctx.fillRect(0, SKY_H, VW, VH - SKY_H);

  // Neon perspective grid floor.
  gridOffset += 0.004 * dtScale;
  if (gridOffset > 1) gridOffset -= 1;
  ctx.strokeStyle = 'rgba(47, 243, 255, 0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const f = (i + gridOffset) / 14;
    const y = SKY_H + f * f * (VH - SKY_H);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(VW, y);
    ctx.stroke();
  }
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(VW / 2, SKY_H);
    ctx.lineTo(VW / 2 + i * (VW / 12), VH);
    ctx.stroke();
  }
}

function drawDragon(d) {
  const flap = Math.sin(d.flap) * 0.6;
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(d.dir, 1);

  if (!LOW_FX) { ctx.shadowColor = d.color; ctx.shadowBlur = 16; }

  ctx.strokeStyle = d.color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.quadraticCurveTo(-40, -6, -52, 6);
  ctx.stroke();

  ctx.fillStyle = d.color;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(-4, -2);
  ctx.lineTo(-30, -26 - flap * 26);
  ctx.lineTo(2, -6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-4, 2);
  ctx.lineTo(-30, 22 + flap * 26);
  ctx.lineTo(2, 6);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(22, -3, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(26, -4, 12, 5);

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(24, -5, 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawFireballs() {
  fireballs.forEach(function (f) {
    ctx.save();
    if (!LOW_FX) { ctx.shadowColor = f.color; ctx.shadowBlur = 14; }
    ctx.globalAlpha = clamp(f.life, 0, 1);
    ctx.fillStyle = '#fff6c2';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = f.color;
    ctx.globalAlpha = clamp(f.life, 0, 1) * 0.6;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

/* Draw a single robot. Simple boxes and lines, with a few per-type flourishes
   so the five fighters look different. */
function drawRobot(r) {
  const s = r.scale;
  const body = r.hitFlash > 0 ? '#ffffff' : r.def.color;
  const accent = r.def.accent;

  ctx.save();
  ctx.translate(r.x, r.y);

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, r.boxH / 2 + 4, 26 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.scale(r.facing, 1);          // mirror so it faces the foe

  ctx.fillStyle = '#2a2350';
  ctx.fillRect(-16 * s, 14 * s, 10 * s, 24 * s);
  ctx.fillRect(6 * s, 14 * s, 10 * s, 24 * s);

  if (!LOW_FX) { ctx.shadowColor = body; ctx.shadowBlur = 14; }
  ctx.fillStyle = body;
  roundRect(-20 * s, -22 * s, 40 * s, 40 * s, 7 * s);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = accent;
  roundRect(-7 * s, -10 * s, 14 * s, 14 * s, 4 * s);
  ctx.fill();

  ctx.fillStyle = body;
  roundRect(-12 * s, -38 * s, 24 * s, 16 * s, 5 * s);
  ctx.fill();
  ctx.fillStyle = '#04121a';
  ctx.fillRect(-8 * s, -33 * s, 16 * s, 5 * s);
  ctx.fillStyle = accent;
  ctx.fillRect(2 * s, -33 * s, 5 * s, 5 * s);

  drawWeaponByShape(r.def.shape, s, accent);

  ctx.restore();

  if (r.shieldActive) {
    ctx.save();
    ctx.translate(r.x, r.y - 4);
    ctx.strokeStyle = 'rgba(47, 243, 255, 0.9)';
    ctx.fillStyle = 'rgba(47, 243, 255, 0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 40 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (r.side === 'player') {
    ctx.fillStyle = '#59ff8f';
    ctx.font = 'bold 12px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', r.x, r.y - 48 * s);
  }
}

function drawWeaponByShape(shape, s, accent) {
  ctx.fillStyle = '#46408a';
  if (shape === 'tank') {
    ctx.fillRect(16 * s, -6 * s, 26 * s, 12 * s);
  } else if (shape === 'sniper') {
    ctx.fillRect(16 * s, -3 * s, 40 * s, 6 * s);
    ctx.fillStyle = accent;
    ctx.fillRect(54 * s, -2 * s, 4 * s, 4 * s);
  } else if (shape === 'storm') {
    ctx.fillRect(16 * s, -10 * s, 20 * s, 5 * s);
    ctx.fillRect(16 * s, -2 * s, 20 * s, 5 * s);
    ctx.fillRect(16 * s, 6 * s, 20 * s, 5 * s);
  } else if (shape === 'plasma') {
    ctx.fillRect(16 * s, -5 * s, 18 * s, 10 * s);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(36 * s, 0, 6 * s, 0, Math.PI * 2);
    ctx.fill();
  } else { // scout
    ctx.fillRect(16 * s, -3 * s, 24 * s, 6 * s);
    ctx.fillStyle = accent;
    ctx.fillRect(-2 * s, -46 * s, 2 * s, 8 * s);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBullets() {
  [playerBullets, enemyBullets].forEach(function (list) {
    list.forEach(function (b) {
      ctx.save();
      if (!LOW_FX) { ctx.shadowColor = b.color; ctx.shadowBlur = b.special ? 18 : 10; }
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, Math.max(1, b.size * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  });
}

function drawParticles() {
  particles.forEach(function (p) {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

/* Health bars, ability meters and (on desktop) the controls hint. */
function drawHUD() {
  const barW = clamp(VW * 0.34, 150, 300);
  drawHealth(14, 26, barW, player, 'left');
  drawHealth(VW - 14 - barW, 26, barW, enemy, 'right');

  const t = now();
  const specialFrac = t >= player.specialReadyAt ? 1 : 1 - (player.specialReadyAt - t) / player.def.special.cooldown;
  const shieldFrac = player.shieldActive ? 1 : (t >= player.shieldReadyAt ? 1 : 1 - (player.shieldReadyAt - t) / player.def.shield.cooldown);
  const metW = clamp(VW * 0.15, 96, 140);
  drawMeter(14, 54, metW, 'Q', specialFrac, '#ff3df0');
  drawMeter(14 + metW + 10, 54, metW, 'E', shieldFrac, player.shieldActive ? '#7ff7ff' : '#2ff3ff');

  // The on-screen buttons explain themselves on touch, so only desktop needs text.
  if (!touchMode) {
    ctx.fillStyle = 'rgba(234, 246, 255, 0.65)';
    ctx.font = '13px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Mouse: move    Space: fire    Q: special    E: shield', VW / 2, VH - 16);
  }
}

function drawHealth(x, y, w, robot, align) {
  const h = 18;
  const frac = clamp(robot.health / robot.maxHealth, 0, 1);

  ctx.fillStyle = '#eaf6ff';
  ctx.font = 'bold 13px Orbitron, sans-serif';
  ctx.textAlign = align === 'right' ? 'right' : 'left';
  ctx.fillText(robot.def.name + (robot.side === 'enemy' ? ' (Rival)' : ''), align === 'right' ? x + w : x, y - 5);

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const fillW = Math.max(0, w * frac);
  ctx.fillStyle = 'hsl(' + (120 * frac) + ', 90%, 55%)';     // green when high, red when low
  if (fillW > 0) { roundRect(x, y, fillW, h, 6); ctx.fill(); }

  ctx.fillStyle = '#04121a';
  ctx.font = 'bold 11px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(Math.ceil(robot.health) + ' / ' + robot.maxHealth, x + w / 2, y + 13);
}

function drawMeter(x, y, w, label, frac, color) {
  const h = 11;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 11px Orbitron, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y + 9);

  const bx = x + 16;
  const bw = w - 16;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(bx, y, bw, h, 4);
  ctx.fill();
  ctx.fillStyle = color;
  const f = clamp(frac, 0, 1);
  if (f > 0) { roundRect(bx, y, bw * f, h, 4); ctx.fill(); }
  if (f >= 1) { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }   // glow when ready
}

/* ---------- The main loop --------------------------------- */

function loop(ts) {
  const dtMs = Math.min(ts - lastTime || 16, 50);   // cap so a tab switch cannot jump the sim
  lastTime = ts;
  const dtScale = dtMs / 16.67;                      // 1 at 60fps

  updateDragons(dtScale, dtMs);
  updateParticles(dtScale);
  if (state === 'battle') updateBattle(dtScale, dtMs);

  ctx.clearRect(0, 0, VW, VH);
  drawBackground(dtScale);
  dragons.forEach(drawDragon);
  drawFireballs();

  if (state === 'battle' || state === 'gameover') {
    drawRobot(enemy);
    drawRobot(player);
    drawBullets();
    drawParticles();
    drawHUD();
  } else {
    drawParticles();
  }

  requestAnimationFrame(loop);
}

/* ---------- 6. Input + start-up --------------------------- */

function startBattle(robotId) {
  const def = getRobotDef(robotId);
  if (!def) return;
  player = makeRobot(def, 'player');
  const enemyDef = ROBOTS[Math.floor(rand(0, ROBOTS.length))];   // random rival
  enemy = makeRobot(enemyDef, 'enemy');

  playerBullets = [];
  enemyBullets = [];
  particles = [];
  keys[' '] = false;
  mouse.x = player.x;
  mouse.y = player.y;

  state = 'battle';
  showScreen(null);
  setTouchControls(true);
}

function buildCards() {
  dom.cards.innerHTML = '';
  ROBOTS.forEach(function (def) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = def.id;

    const mini = document.createElement('canvas');
    mini.width = 64; mini.height = 64;
    card.appendChild(mini);
    drawMiniRobot(mini.getContext('2d'), def);

    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = def.name;
    name.style.color = def.color;
    card.appendChild(name);

    const tag = document.createElement('div');
    tag.className = 'card-tag';
    tag.textContent = def.tag;
    card.appendChild(tag);

    card.appendChild(makeStatRow('SPD', def.stats.speed, '#2ff3ff'));
    card.appendChild(makeStatRow('HP', def.stats.health, '#59ff8f'));
    card.appendChild(makeStatRow('PWR', def.stats.power, '#ff3df0'));

    const badge = document.createElement('div');
    badge.className = 'card-badge';
    badge.textContent = 'Selected';
    card.appendChild(badge);

    card.addEventListener('click', function () {
      selectedRobotId = def.id;
      document.querySelectorAll('.card').forEach(function (c) {
        c.classList.toggle('selected', c.dataset.id === def.id);
      });
      dom.startBattleBtn.disabled = false;
    });

    dom.cards.appendChild(card);
  });
}

function makeStatRow(label, value, color) {
  const row = document.createElement('div');
  row.className = 'stat';
  const lab = document.createElement('span');
  lab.className = 'stat-label';
  lab.textContent = label;
  const track = document.createElement('div');
  track.className = 'stat-track';
  const fill = document.createElement('div');
  fill.className = 'stat-fill';
  fill.style.width = (value / 5 * 100) + '%';
  fill.style.background = color;
  track.appendChild(fill);
  row.appendChild(lab);
  row.appendChild(track);
  return row;
}

function drawMiniRobot(c, def) {
  c.clearRect(0, 0, 64, 64);
  c.save();
  c.translate(32, 38);
  c.shadowColor = def.color;
  c.shadowBlur = 8;
  c.fillStyle = def.color;
  c.fillRect(-14, -16, 28, 28);
  c.fillRect(-9, -28, 18, 12);
  c.shadowBlur = 0;
  c.fillStyle = def.accent;
  c.fillRect(-5, -7, 10, 10);
  c.fillStyle = '#04121a';
  c.fillRect(-6, -25, 12, 4);
  c.fillStyle = '#3a3470';
  c.fillRect(14, -4, 16, 8);
  c.restore();
}

function goToSelect() {
  selectedRobotId = null;
  dom.startBattleBtn.disabled = true;
  document.querySelectorAll('.card').forEach(function (c) { c.classList.remove('selected'); });
  state = 'select';
  setTouchControls(false);
  showScreen('select');
}

/* Attempt to lock to landscape. This works on Android when in fullscreen and
   is silently ignored on iOS, so it is wrapped in a try / catch. */
function tryLockLandscape() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(function () {});
    }
  } catch (e) { /* not supported on this device */ }
}

/* Bind a button so holding it counts as "held" (used for continuous fire). */
function bindHold(btn, onDown, onUp) {
  btn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    btn.classList.add('pressed');
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
    onDown();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
    btn.addEventListener(ev, function () {
      btn.classList.remove('pressed');
      if (onUp) onUp();
    });
  });
}

function init() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');

  dom.start = document.getElementById('start-screen');
  dom.select = document.getElementById('select-screen');
  dom.gameover = document.getElementById('gameover-screen');
  dom.cards = document.getElementById('cards');
  dom.startBattleBtn = document.getElementById('start-battle-btn');
  dom.resultText = document.getElementById('result-text');
  dom.resultSub = document.getElementById('result-sub');
  dom.touch = document.getElementById('touch-controls');

  applyTouchMode();

  resize();
  positionDragons();
  buildCards();

  // --- Menu buttons ---
  document.getElementById('play-btn').addEventListener('click', function () {
    tryLockLandscape();
    goToSelect();
  });
  dom.startBattleBtn.addEventListener('click', function () {
    if (selectedRobotId) startBattle(selectedRobotId);
  });
  document.getElementById('restart-btn').addEventListener('click', goToSelect);

  // --- Movement ---
  // Mouse (desktop): the robot follows the cursor (absolute position).
  // Touch: the robot follows your finger as you drag (relative movement), so
  // you can steer it from anywhere on the screen instead of having to keep your
  // finger over the robot's narrow lane.
  let movePointerId = null;
  let dragLast = null;

  function setAbsolute(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (VW / rect.width);
    mouse.y = (e.clientY - rect.top) * (VH / rect.height);
  }
  function dragRelative(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = clamp(mouse.x + (e.clientX - dragLast.x) * (VW / rect.width), PLAYER_ZONE.xMin, PLAYER_ZONE.xMax);
    mouse.y = clamp(mouse.y + (e.clientY - dragLast.y) * (VH / rect.height), PLAYER_ZONE.yMin, PLAYER_ZONE.yMax);
    dragLast = { x: e.clientX, y: e.clientY };
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (e.pointerType === 'touch') {
      if (movePointerId !== null) return;            // ignore extra fingers on the canvas
      movePointerId = e.pointerId;
      dragLast = { x: e.clientX, y: e.clientY };       // begin the drag without jumping
    } else {
      setAbsolute(e);
    }
  }, { passive: false });

  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') {
      if (e.pointerId !== movePointerId || !dragLast) return;
      dragRelative(e);
    } else {
      setAbsolute(e);
    }
  }, { passive: false });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
    canvas.addEventListener(ev, function (e) {
      if (e.pointerId === movePointerId) { movePointerId = null; dragLast = null; }
    });
  });

  // If static detection missed (some iPads), the first touch turns touch mode on.
  window.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch') enableTouchMode(); }, true);
  window.addEventListener('touchstart', enableTouchMode, { capture: true, passive: true });

  // --- Touch action buttons ---
  bindHold(document.getElementById('fire-btn'),
    function () { keys[' '] = true; },
    function () { keys[' '] = false; });
  document.getElementById('special-btn').addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state === 'battle') trySpecial();
  });
  document.getElementById('shield-btn').addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state === 'battle') tryShield();
  });
  // Safety: releasing anywhere stops continuous fire.
  window.addEventListener('pointerup', function () { keys[' '] = false; });

  // --- Keyboard (desktop) ---
  window.addEventListener('keydown', function (e) {
    const k = e.key.toLowerCase();
    keys[e.key] = true;
    if (e.key === ' ') e.preventDefault();        // do not scroll the page
    if (state === 'battle' && !e.repeat) {
      if (k === 'q') trySpecial();
      if (k === 'e') tryShield();
    }
    if (state === 'gameover' && k === 'r') goToSelect();
  });
  window.addEventListener('keyup', function (e) { keys[e.key] = false; });

  // --- Keep the canvas matched to the screen ---
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  requestAnimationFrame(loop);
}

function trySpecial() {
  const t = now();
  if (t < player.specialReadyAt) return;
  fireWeapon(player, true);
  player.specialReadyAt = t + player.def.special.cooldown;
}

function tryShield() {
  const t = now();
  if (player.shieldActive || t < player.shieldReadyAt) return;
  player.shieldActive = true;
  player.shieldUntil = t + player.def.shield.duration;
  player.shieldReadyAt = t + player.def.shield.cooldown;
}

window.addEventListener('load', init);
