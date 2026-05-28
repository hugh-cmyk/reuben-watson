/* ============================================================
   Robot & Dragon Battle
   A simple 2D canvas game. No build step, no dependencies.

   How it is organised:
     1. Config + helper functions
     2. ROBOTS data (edit this to tweak the fighters)
     3. Game state + screen switching
     4. Robot / bullet / particle / dragon logic
     5. The main loop (update + render)
     6. Input handling and start-up

   The player moves with the mouse and fires with the keyboard.
   Q is a special weapon, E is a shield, R restarts after a result.
   ============================================================ */

'use strict';

/* ---------- 1. Config + helpers --------------------------- */

const CANVAS_W = 960;
const CANVAS_H = 600;
const SKY_H = 250;                 // top region for the dragons / sky

// Where each robot is allowed to move (its centre point stays inside this box).
const PLAYER_ZONE = { xMin: 70,  xMax: 400, yMin: 320, yMax: 545 };
const ENEMY_ZONE  = { xMin: 560, xMax: 885, yMin: 320, yMax: 545 };

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

// Background decoration, built once at start-up.
let stars = [];
let buildings = [];
let gridOffset = 0;

const keys = {};                   // currently held keys, e.g. keys[' ']
const mouse = { x: CANVAS_W * 0.2, y: 430, inside: false };
let lastTime = 0;

// DOM references, filled in on load.
const dom = {};

/* Show one overlay screen and hide the others. Passing null hides them all
   (used during the battle so only the canvas shows). */
function showScreen(name) {
  ['start', 'select', 'gameover'].forEach(function (s) {
    dom[s].classList.toggle('hidden', s !== name);
  });
}

/* ---------- 4a. Robot logic ------------------------------- */

function makeRobot(def, side) {
  const isEnemy = side === 'enemy';
  // The enemy is tuned to be a little easier so the game stays fun and winnable.
  const dmgScale = isEnemy ? 0.75 : 1;
  const rateScale = isEnemy ? 1.2 : 1;

  return {
    def: def,
    side: side,
    facing: isEnemy ? -1 : 1,                 // player faces right, enemy faces left
    x: isEnemy ? 780 : 180,
    y: 440,
    boxW: 52 * def.scale,
    boxH: 78 * def.scale,
    scale: def.scale,
    maxHealth: def.maxHealth,
    health: def.maxHealth,
    moveSpeed: def.moveSpeed,
    hitFlash: 0,                              // counts down after taking a hit
    lastShot: 0,
    // Cooldown bookkeeping for the player's Q and E (enemy ignores these).
    specialReadyAt: 0,
    shieldReadyAt: 0,
    shieldActive: false,
    shieldUntil: 0,
    // Effective weapon after difficulty scaling.
    weapon: {
      count: def.weapon.count,
      fireRate: def.weapon.fireRate * rateScale,
      damage: def.weapon.damage * dmgScale,
      bulletSpeed: def.weapon.bulletSpeed,
      bulletSize: def.weapon.bulletSize,
      spreadDeg: def.weapon.spreadDeg,
    },
    // Enemy AI target, refreshed on a timer.
    aiTimer: 0,
    aiTargetX: isEnemy ? 780 : 180,
    aiTargetY: 440,
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
  const color = special ? def.accent : (robot.def.color);

  for (let i = 0; i < count; i++) {
    let angle = baseAngle;
    if (count > 1) {
      const t = count === 1 ? 0 : (i / (count - 1)) - 0.5;   // -0.5 .. 0.5
      angle += t * (spreadDeg * Math.PI / 180);
    }
    const list = robot.side === 'player' ? playerBullets : enemyBullets;
    list.push({
      x: muzzleX,
      y: muzzleY,
      vx: Math.cos(angle) * w.bulletSpeed,
      vy: Math.sin(angle) * w.bulletSpeed,
      size: w.bulletSize,
      damage: w.damage,
      color: color,
      owner: robot.side,
      special: !!special,
    });
  }

  // A small muzzle flash so firing feels punchy.
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

function makeDragon(x, baseY, color, dir) {
  return {
    x: x, y: baseY, baseY: baseY,
    color: color,
    dir: dir,                       // facing / travel direction: 1 right, -1 left
    speed: rand(0.6, 0.9),
    bob: rand(0, Math.PI * 2),
    flap: rand(0, Math.PI * 2),
    fireTimer: rand(1500, 3500),
  };
}

function initDragons() {
  dragons = [
    makeDragon(220, 90,  '#2ff3ff', 1),
    makeDragon(740, 150, '#ff3df0', -1),
  ];
  fireballs = [];
}

function updateDragons(dtScale, dtMs) {
  dragons.forEach(function (d) {
    d.x += d.dir * d.speed * dtScale;
    // Bounce off the sides and turn around.
    if (d.x < 80) { d.x = 80; d.dir = 1; }
    if (d.x > CANVAS_W - 80) { d.x = CANVAS_W - 80; d.dir = -1; }
    d.bob += 0.03 * dtScale;
    d.flap += 0.18 * dtScale;
    d.y = d.baseY + Math.sin(d.bob) * 22;

    // Throw a fireball at the other dragon now and then.
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
      d.fireTimer = rand(1800, 4200);
    }
  });

  // Move fireballs and pop them when they fade or reach a dragon.
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

  /* --- Player movement: chase the mouse inside the player's zone --- */
  const tx = clamp(mouse.x, PLAYER_ZONE.xMin, PLAYER_ZONE.xMax);
  const ty = clamp(mouse.y, PLAYER_ZONE.yMin, PLAYER_ZONE.yMax);
  moveToward(player, tx, ty, player.moveSpeed, dtScale);

  /* --- Player main fire (held spacebar) --- */
  if (keys[' '] && t - player.lastShot >= player.weapon.fireRate) {
    fireWeapon(player, false);
    player.lastShot = t;
  }

  /* --- Player shield timer --- */
  if (player.shieldActive && t >= player.shieldUntil) {
    player.shieldActive = false;
  }

  /* --- Enemy AI: drift toward the player and fire on its own clock --- */
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

  /* --- Move bullets and drop the ones that leave the arena --- */
  updateBullets(playerBullets, dtScale);
  updateBullets(enemyBullets, dtScale);

  /* --- Collisions --- */
  resolveHits(playerBullets, enemy, false);     // player shots hit the enemy
  resolveHits(enemyBullets, player, true);       // enemy shots hit the player

  /* --- Cool down the hit flash --- */
  if (player.hitFlash > 0) player.hitFlash -= dtMs;
  if (enemy.hitFlash > 0) enemy.hitFlash -= dtMs;

  /* --- Check for a result --- */
  if (enemy.health <= 0 && state === 'battle') endBattle('win');
  else if (player.health <= 0 && state === 'battle') endBattle('lose');
}

function updateBullets(list, dtScale) {
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.x += b.vx * dtScale;
    b.y += b.vy * dtScale;
    if (b.x < -30 || b.x > CANVAS_W + 30 || b.y < -30 || b.y > CANVAS_H + 30) {
      list.splice(i, 1);
    }
  }
}

/* Check a list of bullets against one robot. */
function resolveHits(list, target, targetIsPlayer) {
  const halfW = target.boxW / 2;
  const halfH = target.boxH / 2;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    const hit = b.x > target.x - halfW && b.x < target.x + halfW &&
                b.y > target.y - halfH && b.y < target.y + halfH;
    if (!hit) continue;

    if (targetIsPlayer && target.shieldActive) {
      // Shield blocks the shot completely.
      spawnParticles(b.x, b.y, '#2ff3ff', 8, 3);
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
  showScreen('gameover');
}

/* ---------- 5. Rendering ---------------------------------- */

function initBackground() {
  stars = [];
  for (let i = 0; i < 70; i++) {
    stars.push({ x: rand(0, CANVAS_W), y: rand(0, SKY_H), r: rand(0.5, 1.6), seed: rand(0, 100) });
  }
  buildings = [];
  let bx = 0;
  while (bx < CANVAS_W) {
    const w = rand(38, 80);
    buildings.push({
      x: bx, w: w,
      h: rand(60, 150),
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
  ctx.fillRect(0, 0, CANVAS_W, SKY_H);

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

  // City skyline silhouettes sitting on the horizon.
  buildings.forEach(function (b) {
    const top = SKY_H - b.h;
    ctx.fillStyle = '#0b0e2e';
    ctx.fillRect(b.x, top, b.w, b.h);
    // Neon roof line.
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x, top);
    ctx.lineTo(b.x + b.w, top);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // A few lit windows.
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
  ctx.lineTo(CANVAS_W, SKY_H);
  ctx.stroke();

  // Ground.
  let ground = ctx.createLinearGradient(0, SKY_H, 0, CANVAS_H);
  ground.addColorStop(0, '#140a2c');
  ground.addColorStop(1, '#060414');
  ctx.fillStyle = ground;
  ctx.fillRect(0, SKY_H, CANVAS_W, CANVAS_H - SKY_H);

  // Neon perspective grid floor.
  gridOffset += 0.004 * dtScale;
  if (gridOffset > 1) gridOffset -= 1;
  ctx.strokeStyle = 'rgba(47, 243, 255, 0.18)';
  ctx.lineWidth = 1;
  // Horizontal lines that appear to rush toward the viewer.
  for (let i = 0; i < 14; i++) {
    const f = ((i + gridOffset) / 14);
    const y = SKY_H + f * f * (CANVAS_H - SKY_H);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_W, y);
    ctx.stroke();
  }
  // Vertical lines fanning out from a vanishing point.
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2, SKY_H);
    ctx.lineTo(CANVAS_W / 2 + i * 150, CANVAS_H);
    ctx.stroke();
  }
}

function drawDragon(d) {
  const flap = Math.sin(d.flap) * 0.6;     // wing angle
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(d.dir, 1);                      // face the travel direction

  ctx.shadowColor = d.color;
  ctx.shadowBlur = 16;

  // Tail.
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.quadraticCurveTo(-40, -6, -52, 6);
  ctx.stroke();

  // Wings (flap up and down).
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

  // Body.
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head + snout.
  ctx.beginPath();
  ctx.arc(22, -3, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(26, -4, 12, 5);

  // Glowing eye.
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
    ctx.shadowColor = f.color;
    ctx.shadowBlur = 14;
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

/* Draw a single robot. The shapes are simple boxes and lines, with a few
   per-type flourishes so the five fighters look different. */
function drawRobot(r) {
  const s = r.scale;
  const body = r.hitFlash > 0 ? '#ffffff' : r.def.color;
  const accent = r.def.accent;

  ctx.save();
  ctx.translate(r.x, r.y);

  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, r.boxH / 2 + 4, 26 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.scale(r.facing, 1);          // mirror so it faces the foe

  // Legs.
  ctx.fillStyle = '#2a2350';
  ctx.fillRect(-16 * s, 14 * s, 10 * s, 24 * s);
  ctx.fillRect(6 * s, 14 * s, 10 * s, 24 * s);

  // Body (rounded-ish block) with a neon glow.
  ctx.shadowColor = body;
  ctx.shadowBlur = 14;
  ctx.fillStyle = body;
  roundRect(-20 * s, -22 * s, 40 * s, 40 * s, 7 * s);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Chest light.
  ctx.fillStyle = accent;
  roundRect(-7 * s, -10 * s, 14 * s, 14 * s, 4 * s);
  ctx.fill();

  // Head.
  ctx.fillStyle = body;
  roundRect(-12 * s, -38 * s, 24 * s, 16 * s, 5 * s);
  ctx.fill();
  // Eye visor.
  ctx.fillStyle = '#04121a';
  ctx.fillRect(-8 * s, -33 * s, 16 * s, 5 * s);
  ctx.fillStyle = accent;
  ctx.fillRect(2 * s, -33 * s, 5 * s, 5 * s);

  // Cannon / weapon, always on the facing (right after mirroring) side.
  ctx.fillStyle = '#3a3470';
  drawWeaponByShape(r.def.shape, s, accent);

  ctx.restore();

  // Shield bubble (drawn unmirrored so it stays a clean circle).
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

  // "YOU" marker above the player so it is easy to follow.
  if (r.side === 'player') {
    ctx.fillStyle = '#59ff8f';
    ctx.font = 'bold 12px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', r.x, r.y - 48 * s);
  }
}

/* The barrel(s) differ per robot type for a bit of character. */
function drawWeaponByShape(shape, s, accent) {
  ctx.fillStyle = '#46408a';
  if (shape === 'tank') {
    ctx.fillRect(16 * s, -6 * s, 26 * s, 12 * s);          // thick cannon
  } else if (shape === 'sniper') {
    ctx.fillRect(16 * s, -3 * s, 40 * s, 6 * s);           // long barrel
    ctx.fillStyle = accent;
    ctx.fillRect(54 * s, -2 * s, 4 * s, 4 * s);
  } else if (shape === 'storm') {
    ctx.fillRect(16 * s, -10 * s, 20 * s, 5 * s);          // three short barrels
    ctx.fillRect(16 * s, -2 * s, 20 * s, 5 * s);
    ctx.fillRect(16 * s, 6 * s, 20 * s, 5 * s);
  } else if (shape === 'plasma') {
    ctx.fillRect(16 * s, -5 * s, 18 * s, 10 * s);
    ctx.fillStyle = accent;                                 // glowing emitter
    ctx.beginPath();
    ctx.arc(36 * s, 0, 6 * s, 0, Math.PI * 2);
    ctx.fill();
  } else { // scout
    ctx.fillRect(16 * s, -3 * s, 24 * s, 6 * s);
    ctx.fillStyle = accent;
    ctx.fillRect(-2 * s, -46 * s, 2 * s, 8 * s);            // little antenna
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
      ctx.shadowColor = b.color;
      ctx.shadowBlur = b.special ? 18 : 10;
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

/* Health bars, special / shield meters and the controls hint. */
function drawHUD() {
  drawHealth(20, 22, player, 'left');
  drawHealth(CANVAS_W - 300, 22, enemy, 'right');

  // Player ability meters under the health bar.
  const t = now();
  const specialFrac = t >= player.specialReadyAt ? 1 : 1 - (player.specialReadyAt - t) / player.def.special.cooldown;
  const shieldFrac = player.shieldActive ? 1 : (t >= player.shieldReadyAt ? 1 : 1 - (player.shieldReadyAt - t) / player.def.shield.cooldown);
  drawMeter(20, 58, 130, 'Q', specialFrac, '#ff3df0');
  drawMeter(168, 58, 130, 'E', shieldFrac, player.shieldActive ? '#7ff7ff' : '#2ff3ff');

  // Controls reminder at the bottom.
  ctx.fillStyle = 'rgba(234, 246, 255, 0.65)';
  ctx.font = '13px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Mouse: move    Space: fire    Q: special    E: shield', CANVAS_W / 2, CANVAS_H - 16);
}

function drawHealth(x, y, robot, align) {
  const w = 280, h = 20;
  const frac = clamp(robot.health / robot.maxHealth, 0, 1);

  // Name above the bar.
  ctx.fillStyle = '#eaf6ff';
  ctx.font = 'bold 14px Orbitron, sans-serif';
  ctx.textAlign = align === 'right' ? 'right' : 'left';
  const labelX = align === 'right' ? x + w : x;
  ctx.fillText(robot.def.name + (robot.side === 'enemy' ? ' (Rival)' : ''), labelX, y - 6);

  // Track.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Fill (green when healthy, fading to red when low).
  const fillW = Math.max(0, w * frac);
  const hue = 120 * frac;                          // 120 green -> 0 red
  ctx.fillStyle = 'hsl(' + hue + ', 90%, 55%)';
  if (fillW > 0) { roundRect(x, y, fillW, h, 6); ctx.fill(); }

  // HP number.
  ctx.fillStyle = '#04121a';
  ctx.font = 'bold 12px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(Math.ceil(robot.health) + ' / ' + robot.maxHealth, x + w / 2, y + 14);
}

function drawMeter(x, y, w, label, frac, color) {
  const h = 12;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 11px Orbitron, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y + 10);

  const bx = x + 16;
  const bw = w - 16;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(bx, y, bw, h, 4);
  ctx.fill();
  ctx.fillStyle = color;
  const f = clamp(frac, 0, 1);
  if (f > 0) { roundRect(bx, y, bw * f, h, 4); ctx.fill(); }
  if (f >= 1) {                                    // glow when ready
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/* ---------- The main loop --------------------------------- */

function loop(ts) {
  const dtMs = Math.min(ts - lastTime || 16, 50);  // cap so a tab switch cannot jump the sim
  lastTime = ts;
  const dtScale = dtMs / 16.67;                     // 1 at 60fps

  // Dragons and the background animate in every screen so menus feel alive.
  updateDragons(dtScale, dtMs);
  updateParticles(dtScale);
  if (state === 'battle') updateBattle(dtScale, dtMs);

  // ---- Render ----
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
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
  // The rival is a random robot from the same line-up.
  const enemyDef = ROBOTS[Math.floor(rand(0, ROBOTS.length))];
  enemy = makeRobot(enemyDef, 'enemy');

  playerBullets = [];
  enemyBullets = [];
  particles = [];
  mouse.x = player.x;
  mouse.y = player.y;

  state = 'battle';
  showScreen(null);
}

/* Build the five selectable robot cards, each with a mini preview + stat bars. */
function buildCards() {
  dom.cards.innerHTML = '';
  ROBOTS.forEach(function (def) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = def.id;

    // Mini robot preview drawn on a small canvas.
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

/* A tiny version of the robot for the selection cards. */
function drawMiniRobot(c, def) {
  c.clearRect(0, 0, 64, 64);
  c.save();
  c.translate(32, 38);
  c.shadowColor = def.color;
  c.shadowBlur = 8;
  c.fillStyle = def.color;
  c.fillRect(-14, -16, 28, 28);                 // body
  c.fillRect(-9, -28, 18, 12);                  // head
  c.shadowBlur = 0;
  c.fillStyle = def.accent;
  c.fillRect(-5, -7, 10, 10);                   // chest light
  c.fillStyle = '#04121a';
  c.fillRect(-6, -25, 12, 4);                   // visor
  c.fillStyle = '#3a3470';
  c.fillRect(14, -4, 16, 8);                    // little cannon
  c.restore();
}

function goToSelect() {
  selectedRobotId = null;
  dom.startBattleBtn.disabled = true;
  document.querySelectorAll('.card').forEach(function (c) { c.classList.remove('selected'); });
  state = 'select';
  showScreen('select');
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

  initBackground();
  initDragons();
  buildCards();

  // --- Buttons ---
  document.getElementById('play-btn').addEventListener('click', goToSelect);
  dom.startBattleBtn.addEventListener('click', function () {
    if (selectedRobotId) startBattle(selectedRobotId);
  });
  document.getElementById('restart-btn').addEventListener('click', goToSelect);

  // --- Mouse: track position in canvas coordinates (accounting for scaling) ---
  canvas.addEventListener('mousemove', function (e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    mouse.y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    mouse.inside = true;
  });
  canvas.addEventListener('mouseleave', function () { mouse.inside = false; });

  // --- Keyboard ---
  window.addEventListener('keydown', function (e) {
    const k = e.key.toLowerCase();
    keys[e.key] = true;

    // Stop the spacebar from scrolling the page during battle.
    if (e.key === ' ') e.preventDefault();

    if (state === 'battle' && !e.repeat) {
      if (k === 'q') trySpecial();
      if (k === 'e') tryShield();
    }
    if (state === 'gameover' && k === 'r') goToSelect();
  });
  window.addEventListener('keyup', function (e) { keys[e.key] = false; });

  requestAnimationFrame(loop);
}

/* Q: fire the special weapon if its cooldown has finished. */
function trySpecial() {
  const t = now();
  if (t < player.specialReadyAt) return;
  fireWeapon(player, true);
  player.specialReadyAt = t + player.def.special.cooldown;
}

/* E: raise the shield if its cooldown has finished. */
function tryShield() {
  const t = now();
  if (player.shieldActive || t < player.shieldReadyAt) return;
  player.shieldActive = true;
  player.shieldUntil = t + player.def.shield.duration;
  player.shieldReadyAt = t + player.def.shield.cooldown;
}

window.addEventListener('load', init);
