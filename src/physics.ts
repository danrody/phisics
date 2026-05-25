import { Body, World } from 'p2-es';

export const G = 6.6743e-11;
export const EARTH_MASS_KG = 5.9722e24;
export const EARTH_RADIUS_M = 6_371_000;

export type OrbitConfig = {
  massKg: number;
  radiusM: number;
  speedMps: number;
  angleDeg: number;
};

export type BodyState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type OrbitTone = 'stable' | 'warning' | 'escape' | 'danger';

export type OrbitMetrics = {
  mu: number;
  r: number;
  altitude: number;
  speed: number;
  acceleration: number;
  circularSpeed: number;
  escapeSpeed: number;
  specificEnergy: number;
  angularMomentum: number;
  eccentricity: number;
  semiMajorAxis: number | null;
  periapsis: number | null;
  period: number | null;
  typeLabel: string;
  typeTone: OrbitTone;
};

export type P2Engine = {
  world: World;
  satellite: Body;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function cosmicSpeeds(massKg: number, radiusM: number) {
  const mu = G * massKg;
  const first = Math.sqrt(mu / radiusM);
  const second = Math.sqrt((2 * mu) / radiusM);
  return { first, second };
}

export function initialState(config: OrbitConfig): BodyState {
  const angle = (config.angleDeg * Math.PI) / 180;
  return {
    x: config.radiusM,
    y: 0,
    vx: config.speedMps * Math.sin(angle),
    vy: config.speedMps * Math.cos(angle),
  };
}

export function createP2Engine(state: BodyState): P2Engine {
  const world = new World({
    gravity: [0, 0],
  });
  world.applyGravity = false;
  world.applyDamping = false;
  world.solveConstraints = false;

  const satellite = new Body({
    mass: 1,
    damping: 0,
    angularDamping: 0,
    position: [state.x, state.y],
    velocity: [state.vx, state.vy],
    fixedRotation: true,
  });

  world.addBody(satellite);
  return { world, satellite };
}

export function bodyToState(body: Body): BodyState {
  return {
    x: body.position[0],
    y: body.position[1],
    vx: body.velocity[0],
    vy: body.velocity[1],
  };
}

export function writeStateToBody(body: Body, state: BodyState) {
  body.position[0] = state.x;
  body.position[1] = state.y;
  body.velocity[0] = state.vx;
  body.velocity[1] = state.vy;
}

export function gravityAcceleration(mu: number, x: number, y: number) {
  const r2 = x * x + y * y;
  const r = Math.sqrt(r2);
  const factor = -mu / (r2 * r);
  return {
    ax: factor * x,
    ay: factor * y,
  };
}

export function verletStep(state: BodyState, mu: number, dt: number): BodyState {
  const a0 = gravityAcceleration(mu, state.x, state.y);
  const halfVx = state.vx + 0.5 * a0.ax * dt;
  const halfVy = state.vy + 0.5 * a0.ay * dt;
  const x = state.x + halfVx * dt;
  const y = state.y + halfVy * dt;
  const a1 = gravityAcceleration(mu, x, y);

  return {
    x,
    y,
    vx: halfVx + 0.5 * a1.ax * dt,
    vy: halfVy + 0.5 * a1.ay * dt,
  };
}

export function stepP2Body(body: Body, mu: number, dt: number) {
  const next = verletStep(bodyToState(body), mu, dt);
  writeStateToBody(body, next);
  return next;
}

export function stableTimeStep(config: OrbitConfig) {
  const orbitalUnit = Math.sqrt(config.radiusM ** 3 / (G * config.massKg));
  return clamp(orbitalUnit / 170, 0.2, 12);
}

export function computeMetrics(
  config: OrbitConfig,
  state: BodyState,
  collided = false,
): OrbitMetrics {
  const mu = G * config.massKg;
  const r = Math.hypot(state.x, state.y);
  const speed = Math.hypot(state.vx, state.vy);
  const specificEnergy = 0.5 * speed * speed - mu / r;
  const angularMomentum = state.x * state.vy - state.y * state.vx;
  const h2 = angularMomentum * angularMomentum;
  const eccentricity = Math.sqrt(Math.max(0, 1 + (2 * specificEnergy * h2) / (mu * mu)));
  const semiMajorAxis = specificEnergy < 0 ? -mu / (2 * specificEnergy) : null;
  const periapsis =
    semiMajorAxis && Number.isFinite(semiMajorAxis)
      ? semiMajorAxis * (1 - eccentricity)
      : h2 / (mu * (1 + eccentricity));
  const period = semiMajorAxis ? 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / mu) : null;
  const tolerance = (mu / config.radiusM) * 0.004;

  let typeLabel = 'Разомкнутая гиперболическая';
  let typeTone: OrbitTone = 'escape';

  if (collided) {
    typeLabel = 'Столкновение с планетой';
    typeTone = 'danger';
  } else if (periapsis !== null && periapsis < config.radiusM * 0.995) {
    typeLabel = 'Траектория пересекает планету';
    typeTone = 'danger';
  } else if (specificEnergy < -tolerance) {
    typeLabel = eccentricity < 0.035 ? 'Почти круговая орбита' : 'Замкнутая эллиптическая';
    typeTone = 'stable';
  } else if (Math.abs(specificEnergy) <= tolerance) {
    typeLabel = 'Параболическая граница ухода';
    typeTone = 'warning';
  }

  return {
    mu,
    r,
    altitude: r - config.radiusM,
    speed,
    acceleration: mu / (r * r),
    circularSpeed: Math.sqrt(mu / r),
    escapeSpeed: Math.sqrt((2 * mu) / r),
    specificEnergy,
    angularMomentum,
    eccentricity,
    semiMajorAxis,
    periapsis,
    period,
    typeLabel,
    typeTone,
  };
}

export function predictTrajectory(config: OrbitConfig) {
  const mu = G * config.massKg;
  const start = initialState(config);
  const firstMetrics = computeMetrics(config, start);
  const dt = stableTimeStep(config) * 1.8;
  const orbitalUnit = Math.sqrt(config.radiusM ** 3 / mu);
  const maxTime =
    firstMetrics.period && firstMetrics.period > 0
      ? Math.min(firstMetrics.period * 1.25, orbitalUnit * 90)
      : orbitalUnit * 70;
  const maxDistance = config.radiusM * 15;
  const points: BodyState[] = [start];
  let state = start;
  let time = 0;

  for (let i = 0; i < 12_000 && time < maxTime; i += 1) {
    state = verletStep(state, mu, dt);
    time += dt;

    if (i % 2 === 0) {
      points.push(state);
    }

    const distance = Math.hypot(state.x, state.y);
    if (distance < config.radiusM * 0.992 && time > dt * 3) {
      break;
    }

    if (distance > maxDistance && firstMetrics.specificEnergy >= 0) {
      points.push(state);
      break;
    }
  }

  return points;
}
