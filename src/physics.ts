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

export type GravitySource = {
  x: number;
  y: number;
  massKg: number;
  radiusM: number;
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

function defaultGravitySources(config: OrbitConfig): GravitySource[] {
  return [
    {
      x: 0,
      y: 0,
      massKg: config.massKg,
      radiusM: config.radiusM,
    },
  ];
}

function sourcesForConfig(config: OrbitConfig, gravitySources?: GravitySource[]) {
  return gravitySources && gravitySources.length > 0 ? gravitySources : defaultGravitySources(config);
}

export function gravityAcceleration(mu: number, x: number, y: number) {
  const r2 = x * x + y * y;
  if (r2 <= 0) {
    return { ax: 0, ay: 0 };
  }

  const r = Math.sqrt(r2);
  const factor = -mu / (r2 * r);
  return {
    ax: factor * x,
    ay: factor * y,
  };
}

export function gravityAccelerationFromSources(gravitySources: GravitySource[], x: number, y: number) {
  return gravitySources.reduce(
    (total, source) => {
      const dx = x - source.x;
      const dy = y - source.y;
      const r2 = Math.max(dx * dx + dy * dy, 1);
      const r = Math.sqrt(r2);
      const factor = (-G * source.massKg) / (r2 * r);
      return {
        ax: total.ax + factor * dx,
        ay: total.ay + factor * dy,
      };
    },
    { ax: 0, ay: 0 },
  );
}

export function nearestGravitySource(state: Pick<BodyState, 'x' | 'y'>, gravitySources: GravitySource[]) {
  return gravitySources.reduce(
    (nearest, source) => {
      const distance = Math.hypot(state.x - source.x, state.y - source.y);
      return distance < nearest.distance ? { source, distance } : nearest;
    },
    { source: gravitySources[0], distance: Number.POSITIVE_INFINITY },
  );
}

export function findCollidingSource(
  state: Pick<BodyState, 'x' | 'y'>,
  gravitySources: GravitySource[],
  radiusScale = 0.9985,
) {
  return (
    gravitySources.find((source) => Math.hypot(state.x - source.x, state.y - source.y) < source.radiusM * radiusScale) ??
    null
  );
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

export function verletStepWithSources(state: BodyState, gravitySources: GravitySource[], dt: number): BodyState {
  const a0 = gravityAccelerationFromSources(gravitySources, state.x, state.y);
  const halfVx = state.vx + 0.5 * a0.ax * dt;
  const halfVy = state.vy + 0.5 * a0.ay * dt;
  const x = state.x + halfVx * dt;
  const y = state.y + halfVy * dt;
  const a1 = gravityAccelerationFromSources(gravitySources, x, y);

  return {
    x,
    y,
    vx: halfVx + 0.5 * a1.ax * dt,
    vy: halfVy + 0.5 * a1.ay * dt,
  };
}

export function stepP2Body(body: Body, gravitySources: GravitySource[], dt: number) {
  const next = verletStepWithSources(bodyToState(body), gravitySources, dt);
  writeStateToBody(body, next);
  return next;
}

export function stableTimeStep(config: OrbitConfig, gravitySources?: GravitySource[]) {
  const sources = sourcesForConfig(config, gravitySources);
  const orbitalUnit = Math.sqrt(config.radiusM ** 3 / (G * config.massKg));
  const fastestSourceUnit = sources.reduce((minimum, source) => {
    const sourceUnit = Math.sqrt(source.radiusM ** 3 / (G * source.massKg));
    return Math.min(minimum, sourceUnit);
  }, orbitalUnit);

  return clamp(fastestSourceUnit / 170, 0.05, 12);
}

export function computeMetrics(
  config: OrbitConfig,
  state: BodyState,
  collided = false,
  gravitySources?: GravitySource[],
): OrbitMetrics {
  const sources = sourcesForConfig(config, gravitySources);
  const isMultiBody = sources.length > 1;
  const mu = G * config.massKg;
  const primaryR = Math.max(Math.hypot(state.x, state.y), 1);
  const speed = Math.hypot(state.vx, state.vy);
  const nearest = nearestGravitySource(state, sources);
  const nearestDistance = Math.max(nearest.distance, 1);
  const nearestMu = G * nearest.source.massKg;
  const potential = sources.reduce((sum, source) => {
    const distance = Math.max(Math.hypot(state.x - source.x, state.y - source.y), 1);
    return sum - (G * source.massKg) / distance;
  }, 0);
  const specificEnergy = 0.5 * speed * speed + potential;
  const centralSpecificEnergy = 0.5 * speed * speed - mu / primaryR;
  const angularMomentum = state.x * state.vy - state.y * state.vx;
  const h2 = angularMomentum * angularMomentum;
  const eccentricity = Math.sqrt(Math.max(0, 1 + (2 * centralSpecificEnergy * h2) / (mu * mu)));
  const semiMajorAxis = !isMultiBody && centralSpecificEnergy < 0 ? -mu / (2 * centralSpecificEnergy) : null;
  const periapsis = !isMultiBody
    ? semiMajorAxis && Number.isFinite(semiMajorAxis)
      ? semiMajorAxis * (1 - eccentricity)
      : h2 / (mu * (1 + eccentricity))
    : null;
  const period = semiMajorAxis ? 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / mu) : null;
  const tolerance = (mu / config.radiusM) * 0.004;
  const totalAcceleration = gravityAccelerationFromSources(sources, state.x, state.y);
  const crossesPlanet = sources.some(
    (source) => Math.hypot(state.x - source.x, state.y - source.y) < source.radiusM * 0.995,
  );

  let typeLabel = isMultiBody ? 'Многотельный пролёт ухода' : 'Разомкнутая гиперболическая';
  let typeTone: OrbitTone = 'escape';

  if (collided) {
    typeLabel = 'Столкновение с планетой';
    typeTone = 'danger';
  } else if (crossesPlanet || (periapsis !== null && periapsis < config.radiusM * 0.995)) {
    typeLabel = 'Траектория пересекает планету';
    typeTone = 'danger';
  } else if (isMultiBody && specificEnergy < -tolerance) {
    typeLabel = 'Многотельная связанная';
    typeTone = 'stable';
  } else if (isMultiBody && Math.abs(specificEnergy) <= tolerance) {
    typeLabel = 'Многотельная граница ухода';
    typeTone = 'warning';
  } else if (specificEnergy < -tolerance) {
    typeLabel = eccentricity < 0.035 ? 'Почти круговая орбита' : 'Замкнутая эллиптическая';
    typeTone = 'stable';
  } else if (Math.abs(specificEnergy) <= tolerance) {
    typeLabel = 'Параболическая граница ухода';
    typeTone = 'warning';
  }

  return {
    mu,
    r: nearestDistance,
    altitude: nearest.distance - nearest.source.radiusM,
    speed,
    acceleration: Math.hypot(totalAcceleration.ax, totalAcceleration.ay),
    circularSpeed: Math.sqrt(nearestMu / nearestDistance),
    escapeSpeed: Math.sqrt((2 * nearestMu) / nearestDistance),
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

export function predictTrajectory(config: OrbitConfig, gravitySources?: GravitySource[]) {
  const sources = sourcesForConfig(config, gravitySources);
  const mu = G * config.massKg;
  const start = initialState(config);
  const firstMetrics = computeMetrics(config, start, false, sources);
  const dt = stableTimeStep(config, sources) * 1.8;
  const orbitalUnit = Math.sqrt(config.radiusM ** 3 / mu);
  const maxTime =
    sources.length === 1 && firstMetrics.period && firstMetrics.period > 0
      ? Math.min(firstMetrics.period * 1.25, orbitalUnit * 90)
      : orbitalUnit * (sources.length > 1 ? 90 : 70);
  const sourceMaxDistance = sources.reduce(
    (max, source) => Math.max(max, Math.hypot(source.x, source.y) + source.radiusM),
    config.radiusM,
  );
  const maxDistance = Math.max(config.radiusM * 15, sourceMaxDistance * 1.8);
  const points: BodyState[] = [start];
  let state = start;
  let time = 0;

  for (let i = 0; i < 12_000 && time < maxTime; i += 1) {
    state = verletStepWithSources(state, sources, dt);
    time += dt;

    if (i % 2 === 0) {
      points.push(state);
    }

    const distance = Math.hypot(state.x, state.y);
    if (findCollidingSource(state, sources, 0.992) && time > dt * 3) {
      break;
    }

    if (distance > maxDistance && firstMetrics.specificEnergy >= 0) {
      points.push(state);
      break;
    }
  }

  return points;
}
