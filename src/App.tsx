import {
  Activity,
  Atom,
  ChevronDown,
  Gauge,
  Orbit,
  Pause,
  Play,
  Plus,
  Radar,
  RotateCcw,
  Satellite,
  Settings2,
  Sparkles,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react';
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import {
  BodyState,
  EARTH_MASS_KG,
  EARTH_RADIUS_M,
  G,
  GravitySource,
  OrbitConfig,
  OrbitMetrics,
  bodyToState,
  clamp,
  computeMetrics,
  cosmicSpeeds,
  createP2Engine,
  findCollidingSource,
  initialState,
  predictTrajectory,
  stableTimeStep,
  stepP2Body,
} from './physics';
import './styles.css';

type DisplayOptions = {
  showTrail: boolean;
  showVelocity: boolean;
  showGravity: boolean;
  autoScale: boolean;
};

type Telemetry = {
  time: number;
  state: BodyState;
  metrics: OrbitMetrics;
  collided: boolean;
};

type SampleRow = {
  time: number;
  altitude: number;
  speed: number;
  energy: number;
  acceleration: number;
  typeLabel: string;
};

type PlanetVisualId = 'custom' | 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

type PlanetPreset = {
  id: Exclude<PlanetVisualId, 'custom'>;
  name: string;
  massE24: number;
  radiusKm: number;
};

type PlanetVisual = {
  glow: string;
  haze: string;
  stops: Array<[number, string]>;
  bandColor: string;
  bandAlpha: number;
  bandCount: number;
  bandTilt: number;
  shadow: string;
  spots?: Array<{ x: number; y: number; rx: number; ry: number; color: string; alpha: number }>;
  ring?: { color: string; shadow: string };
};

type ExtraPlanetConfig = {
  id: string;
  name: string;
  visualId: PlanetVisualId;
  massE24: number;
  radiusKm: number;
  distanceKm: number;
  angleDeg: number;
};

type SimulationPlanet = GravitySource & {
  id: string;
  name: string;
  visualId: PlanetVisualId;
};

const earthMassE24 = EARTH_MASS_KG / 1e24;
const earthRadiusKm = EARTH_RADIUS_M / 1000;
const maxExtraPlanets = 4;
const maxExtraDistanceKm = 25_000_000;
const minLaunchAngleDeg = -180;
const maxLaunchAngleDeg = 180;
const gravityVectorColors = ['#ffbd63', '#7eb3ff', '#ff7892', '#b8ffee', '#d7b7ff'];

const planetPresets: PlanetPreset[] = [
  { id: 'mercury', name: 'Меркурий', massE24: 0.33011, radiusKm: 2439.7 },
  { id: 'venus', name: 'Венера', massE24: 4.8675, radiusKm: 6051.8 },
  { id: 'earth', name: 'Земля', massE24: earthMassE24, radiusKm: earthRadiusKm },
  { id: 'mars', name: 'Марс', massE24: 0.64171, radiusKm: 3389.5 },
  { id: 'jupiter', name: 'Юпитер', massE24: 1898.13, radiusKm: 69911 },
  { id: 'saturn', name: 'Сатурн', massE24: 568.32, radiusKm: 58232 },
  { id: 'uranus', name: 'Уран', massE24: 86.811, radiusKm: 25362 },
  { id: 'neptune', name: 'Нептун', massE24: 102.409, radiusKm: 24622 },
];

const planetVisuals: Record<PlanetVisualId, PlanetVisual> = {
  custom: {
    glow: 'rgba(69, 210, 191, 0.58)',
    haze: 'rgba(63, 218, 195, 0.24)',
    stops: [
      [0, '#d8fff5'],
      [0.18, '#7df1d7'],
      [0.48, '#217c85'],
      [0.76, '#123c63'],
      [1, '#07131f'],
    ],
    bandColor: '#f1c36a',
    bandAlpha: 0.32,
    bandCount: 7,
    bandTilt: 0.18,
    shadow: '#07131f',
  },
  mercury: {
    glow: 'rgba(191, 185, 171, 0.34)',
    haze: 'rgba(176, 169, 154, 0.18)',
    stops: [
      [0, '#fff0cf'],
      [0.24, '#b9aa93'],
      [0.58, '#6e675e'],
      [1, '#252525'],
    ],
    bandColor: '#2f2c28',
    bandAlpha: 0.16,
    bandCount: 0,
    bandTilt: 0,
    shadow: '#151412',
    spots: [
      { x: -0.24, y: -0.16, rx: 0.1, ry: 0.07, color: '#3b3935', alpha: 0.32 },
      { x: 0.2, y: 0.18, rx: 0.08, ry: 0.06, color: '#e3d0b4', alpha: 0.22 },
      { x: -0.02, y: 0.32, rx: 0.06, ry: 0.05, color: '#2a2927', alpha: 0.28 },
    ],
  },
  venus: {
    glow: 'rgba(255, 212, 118, 0.45)',
    haze: 'rgba(255, 198, 86, 0.21)',
    stops: [
      [0, '#fff7cc'],
      [0.25, '#f5c66d'],
      [0.58, '#c77b35'],
      [1, '#4f2f1d'],
    ],
    bandColor: '#fff0af',
    bandAlpha: 0.28,
    bandCount: 8,
    bandTilt: -0.08,
    shadow: '#2b1a12',
  },
  earth: {
    glow: 'rgba(74, 177, 255, 0.5)',
    haze: 'rgba(74, 210, 255, 0.22)',
    stops: [
      [0, '#eaffff'],
      [0.18, '#68d7c8'],
      [0.42, '#217ab8'],
      [0.72, '#173d7d'],
      [1, '#071421'],
    ],
    bandColor: '#e9f8ca',
    bandAlpha: 0.28,
    bandCount: 6,
    bandTilt: 0.12,
    shadow: '#071421',
    spots: [
      { x: -0.22, y: -0.05, rx: 0.18, ry: 0.08, color: '#55b779', alpha: 0.34 },
      { x: 0.12, y: 0.18, rx: 0.14, ry: 0.06, color: '#8ed16f', alpha: 0.26 },
      { x: -0.08, y: 0.28, rx: 0.12, ry: 0.04, color: '#ffffff', alpha: 0.24 },
    ],
  },
  mars: {
    glow: 'rgba(255, 103, 73, 0.44)',
    haze: 'rgba(255, 122, 76, 0.2)',
    stops: [
      [0, '#ffe1b8'],
      [0.24, '#e86f43'],
      [0.56, '#a53f2f'],
      [1, '#371815'],
    ],
    bandColor: '#ffc07a',
    bandAlpha: 0.18,
    bandCount: 5,
    bandTilt: -0.14,
    shadow: '#230f0d',
    spots: [
      { x: -0.28, y: -0.08, rx: 0.14, ry: 0.08, color: '#6f2b24', alpha: 0.36 },
      { x: 0.18, y: 0.22, rx: 0.1, ry: 0.05, color: '#ffd8ae', alpha: 0.28 },
    ],
  },
  jupiter: {
    glow: 'rgba(255, 198, 122, 0.48)',
    haze: 'rgba(255, 184, 111, 0.22)',
    stops: [
      [0, '#fff3ce'],
      [0.22, '#eac37e'],
      [0.52, '#b27245'],
      [0.78, '#6c473b'],
      [1, '#241a17'],
    ],
    bandColor: '#ffe0a4',
    bandAlpha: 0.48,
    bandCount: 11,
    bandTilt: 0.03,
    shadow: '#241a17',
    spots: [{ x: 0.18, y: 0.18, rx: 0.2, ry: 0.095, color: '#c84f3f', alpha: 0.72 }],
  },
  saturn: {
    glow: 'rgba(246, 213, 146, 0.44)',
    haze: 'rgba(246, 213, 146, 0.2)',
    stops: [
      [0, '#fff6d5'],
      [0.24, '#e7c276'],
      [0.56, '#a88955'],
      [1, '#3b2c20'],
    ],
    bandColor: '#fff0bd',
    bandAlpha: 0.34,
    bandCount: 8,
    bandTilt: 0.02,
    shadow: '#21180f',
    ring: { color: 'rgba(244, 217, 159, 0.72)', shadow: 'rgba(255, 226, 165, 0.42)' },
  },
  uranus: {
    glow: 'rgba(127, 242, 235, 0.46)',
    haze: 'rgba(127, 242, 235, 0.2)',
    stops: [
      [0, '#ecfffb'],
      [0.26, '#80f0e8'],
      [0.62, '#4fb3c4'],
      [1, '#17374f'],
    ],
    bandColor: '#d8fffb',
    bandAlpha: 0.16,
    bandCount: 4,
    bandTilt: 0.22,
    shadow: '#10263a',
  },
  neptune: {
    glow: 'rgba(73, 116, 255, 0.5)',
    haze: 'rgba(73, 116, 255, 0.22)',
    stops: [
      [0, '#dbe8ff'],
      [0.24, '#5b91ff'],
      [0.58, '#2549c8'],
      [1, '#081340'],
    ],
    bandColor: '#9dd5ff',
    bandAlpha: 0.24,
    bandCount: 5,
    bandTilt: -0.1,
    shadow: '#071035',
    spots: [{ x: 0.18, y: -0.12, rx: 0.13, ry: 0.07, color: '#0b1d6f', alpha: 0.42 }],
  },
};

function formatSpeed(value: number) {
  return `${(value / 1000).toFixed(2)} км/с`;
}

function formatDistance(value: number) {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(2)} млн км`;
  }
  return `${sign}${(abs / 1000).toFixed(1)} км`;
}

function formatEnergy(value: number) {
  return `${(value / 1_000_000).toFixed(2)} МДж/кг`;
}

function formatAcceleration(value: number) {
  return `${value.toFixed(2)} м/с²`;
}

function formatTime(value: number) {
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours} ч ${minutes.toString().padStart(2, '0')} мин`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function extraPlanetMinDistanceKm(primaryRadiusKm: number, planetRadiusKm: number) {
  return primaryRadiusKm + planetRadiusKm + 100;
}

function normalizeExtraPlanet(planet: ExtraPlanetConfig, primaryRadiusKm: number): ExtraPlanetConfig {
  const massE24 = clamp(finiteOr(planet.massE24, earthMassE24), 0.001, 2500);
  const radiusKm = clamp(finiteOr(planet.radiusKm, earthRadiusKm), 300, 140000);
  const minDistance = extraPlanetMinDistanceKm(primaryRadiusKm, radiusKm);

  return {
    ...planet,
    massE24,
    radiusKm,
    distanceKm: clamp(finiteOr(planet.distanceKm, primaryRadiusKm * 8), minDistance, maxExtraDistanceKm),
    angleDeg: clamp(finiteOr(planet.angleDeg, 0), -180, 180),
  };
}

function createExtraPlanet(index: number, primaryRadiusKm: number): ExtraPlanetConfig {
  const preset = planetPresets.find((planet) => planet.id === 'mars') ?? planetPresets[0];
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `extra-${Date.now()}-${index}`;

  return normalizeExtraPlanet(
    {
      id,
      name: `Планета ${index + 2}`,
      visualId: preset.id,
      massE24: preset.massE24,
      radiusKm: preset.radiusKm,
      distanceKm: 25_000,
      angleDeg: 0,
    },
    primaryRadiusKm,
  );
}

function extraPlanetPosition(planet: ExtraPlanetConfig) {
  const angleRad = (planet.angleDeg * Math.PI) / 180;
  const distanceM = planet.distanceKm * 1000;
  return {
    x: Math.cos(angleRad) * distanceM,
    y: Math.sin(angleRad) * distanceM,
  };
}

function App() {
  const [planetMassE24, setPlanetMassE24] = useState(earthMassE24);
  const [planetRadiusKm, setPlanetRadiusKm] = useState(earthRadiusKm);
  const [speedRatio, setSpeedRatio] = useState(1);
  const [angleDeg, setAngleDeg] = useState(0);
  const [timeScale, setTimeScale] = useState(720);
  const [isRunning, setIsRunning] = useState(false);
  const [launchToken, setLaunchToken] = useState(0);
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [extraPlanets, setExtraPlanets] = useState<ExtraPlanetConfig[]>([]);
  const [isPlanetMenuOpen, setIsPlanetMenuOpen] = useState(false);
  const [planetMenuDirection, setPlanetMenuDirection] = useState<'up' | 'down'>('down');
  const [extraPlanetMenuId, setExtraPlanetMenuId] = useState<string | null>(null);
  const [extraPlanetMenuDirection, setExtraPlanetMenuDirection] = useState<'up' | 'down'>('down');
  const [options, setOptions] = useState<DisplayOptions>({
    showTrail: true,
    showVelocity: true,
    showGravity: true,
    autoScale: true,
  });

  const massKg = planetMassE24 * 1e24;
  const radiusM = planetRadiusKm * 1000;
  const selectedPlanetPreset = useMemo<PlanetVisualId>(() => {
    const match = planetPresets.find(
      (planet) => Math.abs(planet.massE24 - planetMassE24) < 0.0005 && Math.abs(planet.radiusKm - planetRadiusKm) < 0.05,
    );
    return match?.id ?? 'custom';
  }, [planetMassE24, planetRadiusKm]);
  const selectedPlanetName = planetPresets.find((planet) => planet.id === selectedPlanetPreset)?.name ?? 'Своя планета';
  const speeds = useMemo(() => cosmicSpeeds(massKg, radiusM), [massKg, radiusM]);
  const speedMps = speedRatio * speeds.first;
  const config = useMemo<OrbitConfig>(
    () => ({
      massKg,
      radiusM,
      speedMps,
      angleDeg,
    }),
    [angleDeg, massKg, radiusM, speedMps],
  );
  const normalizedExtraPlanets = useMemo(
    () => extraPlanets.map((planet) => normalizeExtraPlanet(planet, planetRadiusKm)),
    [extraPlanets, planetRadiusKm],
  );
  const simulationPlanets = useMemo<SimulationPlanet[]>(() => {
    const primary: SimulationPlanet = {
      id: 'primary',
      name: selectedPlanetName,
      visualId: selectedPlanetPreset,
      x: 0,
      y: 0,
      massKg,
      radiusM,
    };

    return [
      primary,
      ...normalizedExtraPlanets.map((planet): SimulationPlanet => {
        const position = extraPlanetPosition(planet);
        return {
          id: planet.id,
          name: planet.name,
          visualId: planet.visualId,
          x: position.x,
          y: position.y,
          massKg: planet.massE24 * 1e24,
          radiusM: planet.radiusKm * 1000,
        };
      }),
    ];
  }, [massKg, normalizedExtraPlanets, radiusM, selectedPlanetName, selectedPlanetPreset]);
  const initialTelemetry = useMemo<Telemetry>(() => {
    const state = initialState(config);
    return {
      time: 0,
      state,
      metrics: computeMetrics(config, state, false, simulationPlanets),
      collided: false,
    };
  }, [config, simulationPlanets]);
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry);
  const lastSampleTime = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    setIsRunning(false);
    setTelemetry(initialTelemetry);
    setSamples([]);
    lastSampleTime.current = Number.NEGATIVE_INFINITY;
  }, [initialTelemetry]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.intro-copy, .formula-strip, .control-panel, .data-panel', {
        y: 18,
        duration: 0.75,
        ease: 'power3.out',
        stagger: 0.07,
      });
    });
    return () => ctx.revert();
  }, []);

  const handleTelemetry = useCallback(
    (next: Telemetry) => {
      setTelemetry(next);
      const rowInterval = clamp(config.radiusM / Math.max(speeds.first, 1) / 4, 30, 420);
      if (next.time > 0 && next.time - lastSampleTime.current >= rowInterval) {
        lastSampleTime.current = next.time;
        setSamples((current) => {
          const row: SampleRow = {
            time: next.time,
            altitude: next.metrics.altitude,
            speed: next.metrics.speed,
            energy: next.metrics.specificEnergy,
            acceleration: next.metrics.acceleration,
            typeLabel: next.metrics.typeLabel,
          };
          return [row, ...current].slice(0, 10);
        });
      }
    },
    [config.radiusM, speeds.first],
  );

  const launch = () => {
    setSamples([]);
    lastSampleTime.current = Number.NEGATIVE_INFINITY;
    setLaunchToken((value) => value + 1);
    setIsRunning(true);
    gsap.fromTo(
      '.visual-stage',
      { '--launch-glow': 0.85 },
      { '--launch-glow': 0, duration: 1.4, ease: 'power2.out' },
    );
  };

  const resetEarth = () => {
    setPlanetMassE24(earthMassE24);
    setPlanetRadiusKm(earthRadiusKm);
    setExtraPlanets([]);
    setSpeedRatio(1);
    setAngleDeg(0);
    setTimeScale(720);
    setIsRunning(false);
    setLaunchToken((value) => value + 1);
  };

  const selectPlanetPreset = (presetId: PlanetVisualId) => {
    const preset = planetPresets.find((planet) => planet.id === presetId);
    if (!preset) {
      setIsPlanetMenuOpen(false);
      return;
    }

    setPlanetMassE24(preset.massE24);
    setPlanetRadiusKm(preset.radiusKm);
    setIsPlanetMenuOpen(false);
  };

  const addExtraPlanet = () => {
    setExtraPlanets((current) => {
      if (current.length >= maxExtraPlanets) {
        return current;
      }

      return [...current, createExtraPlanet(current.length, planetRadiusKm)];
    });
  };

  const updateExtraPlanet = (planetId: string, updater: (planet: ExtraPlanetConfig) => ExtraPlanetConfig) => {
    setExtraPlanets((current) =>
      current.map((planet) =>
        planet.id === planetId ? normalizeExtraPlanet(updater(normalizeExtraPlanet(planet, planetRadiusKm)), planetRadiusKm) : planet,
      ),
    );
  };

  const removeExtraPlanet = (planetId: string) => {
    setExtraPlanets((current) => current.filter((planet) => planet.id !== planetId));
    setExtraPlanetMenuId((current) => (current === planetId ? null : current));
  };

  const selectExtraPlanetPreset = (planetId: string, visualId: PlanetVisualId) => {
    updateExtraPlanet(planetId, (planet) => {
      const preset = planetPresets.find((candidate) => candidate.id === visualId);
      if (!preset) {
        return { ...planet, visualId };
      }

      return {
        ...planet,
        visualId: preset.id,
        massE24: preset.massE24,
        radiusKm: preset.radiusKm,
      };
    });
    setExtraPlanetMenuId(null);
  };

  const toggleOption = (key: keyof DisplayOptions) => {
    setOptions((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const statusClass = `status-pill ${telemetry.metrics.typeTone}`;

  return (
    <div className="app-shell">
      <header className="intro">
        <div className="intro-copy">
          <div className="eyebrow">
            <Atom size={18} />
            Родыгин Даниил
          </div>
          <h1>Гравитационный катапульт</h1>
          <p>
            Сайт показывает, как начальная скорость и угол запуска у поверхности планеты
            меняют траекторию тела: падение, замкнутую орбиту, параболический уход или
            гиперболический пролёт. Слайдеры управляют параметрами, а таблица фиксирует
            скорость, высоту, ускорение и орбитальную энергию во время запуска.
          </p>
        </div>
        <div className="formula-strip" aria-label="Основные формулы модели">
          <div className="formula-row">
            <strong>v₁</strong>
            <span className="equation">
              =
              <span className="sqrt-formula">
                <span className="radicand">
                  <span className="fraction">
                    <span>GM</span>
                    <span>R</span>
                  </span>
                </span>
              </span>
            </span>
          </div>
          <div className="formula-row">
            <strong>v₂</strong>
            <span className="equation">
              =
              <span className="sqrt-formula">
                <span className="radicand">
                  <span className="fraction">
                    <span>2GM</span>
                    <span>R</span>
                  </span>
                </span>
              </span>
            </span>
          </div>
          <div className="formula-row">
            <strong>ε</strong>
            <span className="equation">
              =
              <span className="fraction">
                <span>v²</span>
                <span>2</span>
              </span>
              −
              <span className="fraction">
                <span>GM</span>
                <span>r</span>
              </span>
            </span>
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="visual-stage" aria-label="Визуализация траектории">
          <GravityCanvas
            config={config}
            planets={simulationPlanets}
            launchToken={launchToken}
            running={isRunning}
            timeScale={timeScale}
            options={options}
            onTelemetry={handleTelemetry}
            onStop={() => setIsRunning(false)}
          />

          <div className="stage-hud">
            <div className={statusClass}>
              <Orbit size={18} />
              {telemetry.metrics.typeLabel}
            </div>
            <div className="live-chip">
              <Timer size={17} />
              t = {formatTime(telemetry.time)}
            </div>
          </div>

          <div className="metric-grid">
            <MetricCard
              icon={<Gauge size={18} />}
              label="Скорость"
              value={formatSpeed(telemetry.metrics.speed)}
              detail={`v / v₁ = ${(telemetry.metrics.speed / speeds.first).toFixed(3)}`}
            />
            <MetricCard
              icon={<Zap size={18} />}
              label="Энергия"
              value={formatEnergy(telemetry.metrics.specificEnergy)}
              detail={telemetry.metrics.specificEnergy < 0 ? 'связана с системой' : 'уход возможен'}
            />
            <MetricCard
              icon={<Radar size={18} />}
              label="Высота"
              value={formatDistance(telemetry.metrics.altitude)}
              detail={`r = ${formatDistance(telemetry.metrics.r)}`}
            />
          </div>
        </section>

        <aside className="control-rail" aria-label="Панель управления моделью">
          <section className="control-panel launch-panel">
            <div className="panel-title">
              <Satellite size={19} />
              Запуск
            </div>
            <div className="launch-actions">
              <button className="primary-action" type="button" onClick={launch}>
                <Play size={19} />
                {launchToken === 0 ? 'Запустить' : 'Перезапустить'}
              </button>
              <button
                className="icon-action"
                type="button"
                onClick={() => setIsRunning((value) => !value)}
                aria-label={isRunning ? 'Пауза' : 'Продолжить'}
              >
                {isRunning ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button className="icon-action" type="button" onClick={resetEarth} aria-label="Сбросить к Земле">
                <RotateCcw size={20} />
              </button>
            </div>

            <SliderField
              label="Начальная скорость"
              value={speedRatio}
              min={0.15}
              max={2}
              step={0.001}
              onChange={setSpeedRatio}
              readout={formatSpeed(speedMps)}
              editable={{
                value: speedMps / 1000,
                min: (0.15 * speeds.first) / 1000,
                max: (2 * speeds.first) / 1000,
                step: 0.01,
                ariaLabel: 'Ввести начальную скорость',
                format: (value) => `${value.toFixed(2)} км/с`,
                onCommit: (value) => setSpeedRatio(clamp((value * 1000) / speeds.first, 0.15, 2)),
              }}
              hint={`1-я: ${formatSpeed(speeds.first)} · 2-я: ${formatSpeed(speeds.second)}`}
            />

            <div className="preset-row" aria-label="Предустановленные скорости">
              <button type="button" onClick={() => setSpeedRatio(1)}>
                v₁
              </button>
              <button type="button" onClick={() => setSpeedRatio(Math.SQRT2)}>
                v₂
              </button>
              <button type="button" onClick={() => setSpeedRatio(Math.SQRT2 * 1.25)}>
                1.25v₂
              </button>
            </div>

            <SliderField
              label="Угол к горизонту"
              value={angleDeg}
              min={minLaunchAngleDeg}
              max={maxLaunchAngleDeg}
              step={0.1}
              onChange={setAngleDeg}
              readout={`${angleDeg.toFixed(1)}°`}
              editable={{
                value: angleDeg,
                min: minLaunchAngleDeg,
                max: maxLaunchAngleDeg,
                step: 0.1,
                ariaLabel: 'Ввести угол запуска',
                format: (value) => `${value.toFixed(1)}°`,
                onCommit: setAngleDeg,
              }}
              hint="0° — по касательной; доступен полный разворот направления"
            />
          </section>

          <section className="control-panel planet-panel">
            <div className="panel-title">
              <Settings2 size={19} />
              Планета и время
            </div>
            <div
              className="planet-picker"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsPlanetMenuOpen(false);
                }
              }}
            >
              <span>Готовая планета</span>
              <button
                className="planet-select-button"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isPlanetMenuOpen}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const spaceBelow = window.innerHeight - rect.bottom;
                  const spaceAbove = rect.top;
                  setPlanetMenuDirection(spaceBelow < 330 && spaceAbove > spaceBelow ? 'up' : 'down');
                  setIsPlanetMenuOpen((value) => !value);
                }}
              >
                <span className={`planet-swatch ${selectedPlanetPreset}`} aria-hidden="true" />
                <strong>{selectedPlanetName}</strong>
                <ChevronDown size={17} />
              </button>
              {isPlanetMenuOpen && (
                <div className={`planet-menu ${planetMenuDirection}`} role="listbox" aria-label="Готовые планеты">
                  <button
                    className={`planet-option ${selectedPlanetPreset === 'custom' ? 'active' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={selectedPlanetPreset === 'custom'}
                    onClick={() => selectPlanetPreset('custom')}
                  >
                    <span className="planet-swatch custom" aria-hidden="true" />
                    Своя планета
                  </button>
                {planetPresets.map((planet) => (
                  <button
                    className={`planet-option ${selectedPlanetPreset === planet.id ? 'active' : ''}`}
                    key={planet.id}
                    type="button"
                    role="option"
                    aria-selected={selectedPlanetPreset === planet.id}
                    onClick={() => selectPlanetPreset(planet.id)}
                  >
                    <span className={`planet-swatch ${planet.id}`} aria-hidden="true" />
                    {planet.name}
                  </button>
                ))}
                </div>
              )}
            </div>
            <div className="input-grid">
              <label>
                <span>Масса, 10²⁴ кг</span>
                <input
                  type="number"
                  min="0.01"
                  max="500"
                  step="0.001"
                  value={planetMassE24}
                  onChange={(event) => setPlanetMassE24(clamp(Number(event.target.value) || 0.01, 0.01, 500))}
                />
              </label>
              <label>
                <span>Радиус, км</span>
                <input
                  type="number"
                  min="500"
                  max="120000"
                  step="1"
                  value={planetRadiusKm}
                  onChange={(event) => setPlanetRadiusKm(clamp(Number(event.target.value) || 500, 500, 120000))}
                />
              </label>
            </div>

            <div className="extra-planets">
              <div className="extra-planets-title">
                <span>Дополнительные планеты</span>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={addExtraPlanet}
                  disabled={normalizedExtraPlanets.length >= maxExtraPlanets}
                >
                  <Plus size={16} />
                  Добавить
                </button>
              </div>

              {normalizedExtraPlanets.length === 0 ? (
                <div className="planet-empty">Нет дополнительных планет</div>
              ) : (
                normalizedExtraPlanets.map((planet) => {
                  const minDistanceKm = extraPlanetMinDistanceKm(planetRadiusKm, planet.radiusKm);
                  const planetName = planetPresets.find((preset) => preset.id === planet.visualId)?.name ?? 'Своя планета';
                  return (
                    <div className="extra-planet-card" key={planet.id}>
                      <div className="extra-planet-head">
                        <span className={`planet-swatch ${planet.visualId}`} aria-hidden="true" />
                        <strong>{planet.name}</strong>
                        <button
                          className="icon-action compact"
                          type="button"
                          onClick={() => removeExtraPlanet(planet.id)}
                          aria-label={`Удалить ${planet.name}`}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>

                      <div className="planet-config-grid">
                        <div
                          className="planet-picker compact-picker wide"
                          onBlur={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget)) {
                              setExtraPlanetMenuId(null);
                            }
                          }}
                        >
                          <span>Тип</span>
                          <button
                            className="planet-select-button"
                            type="button"
                            aria-haspopup="listbox"
                            aria-expanded={extraPlanetMenuId === planet.id}
                            onClick={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              const spaceBelow = window.innerHeight - rect.bottom;
                              const spaceAbove = rect.top;
                              setExtraPlanetMenuDirection(spaceBelow < 330 && spaceAbove > spaceBelow ? 'up' : 'down');
                              setExtraPlanetMenuId((current) => (current === planet.id ? null : planet.id));
                            }}
                          >
                            <span className={`planet-swatch ${planet.visualId}`} aria-hidden="true" />
                            <strong>{planetName}</strong>
                            <ChevronDown size={17} />
                          </button>
                          {extraPlanetMenuId === planet.id && (
                            <div className={`planet-menu ${extraPlanetMenuDirection}`} role="listbox" aria-label="Тип дополнительной планеты">
                              <button
                                className={`planet-option ${planet.visualId === 'custom' ? 'active' : ''}`}
                                type="button"
                                role="option"
                                aria-selected={planet.visualId === 'custom'}
                                onClick={() => selectExtraPlanetPreset(planet.id, 'custom')}
                              >
                                <span className="planet-swatch custom" aria-hidden="true" />
                                Своя планета
                              </button>
                              {planetPresets.map((preset) => (
                                <button
                                  className={`planet-option ${planet.visualId === preset.id ? 'active' : ''}`}
                                  key={preset.id}
                                  type="button"
                                  role="option"
                                  aria-selected={planet.visualId === preset.id}
                                  onClick={() => selectExtraPlanetPreset(planet.id, preset.id)}
                                >
                                  <span className={`planet-swatch ${preset.id}`} aria-hidden="true" />
                                  {preset.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <label>
                          <span>Расстояние, км</span>
                          <input
                            type="number"
                            min={minDistanceKm}
                            max={maxExtraDistanceKm}
                            step="100"
                            value={planet.distanceKm}
                            onChange={(event) =>
                              updateExtraPlanet(planet.id, (current) => ({
                                ...current,
                                distanceKm: Number(event.target.value) || minDistanceKm,
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Угол, °</span>
                          <input
                            type="number"
                            min="-180"
                            max="180"
                            step="1"
                            value={planet.angleDeg}
                            onChange={(event) =>
                              updateExtraPlanet(planet.id, (current) => ({
                                ...current,
                                angleDeg: Number(event.target.value) || 0,
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Масса, 10²⁴ кг</span>
                          <input
                            type="number"
                            min="0.001"
                            max="2500"
                            step="0.001"
                            value={planet.massE24}
                            onChange={(event) =>
                              updateExtraPlanet(planet.id, (current) => ({
                                ...current,
                                massE24: Number(event.target.value) || 0.001,
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Радиус, км</span>
                          <input
                            type="number"
                            min="300"
                            max="140000"
                            step="1"
                            value={planet.radiusKm}
                            onChange={(event) =>
                              updateExtraPlanet(planet.id, (current) => ({
                                ...current,
                                radiusKm: Number(event.target.value) || 300,
                              }))
                            }
                          />
                        </label>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <SliderField
              label="Ускорение времени"
              value={timeScale}
              min={60}
              max={1800}
              step={10}
              onChange={setTimeScale}
              readout={`×${timeScale.toFixed(0)}`}
              editable={{
                value: timeScale,
                min: 60,
                max: 1800,
                step: 10,
                ariaLabel: 'Ввести ускорение времени',
                format: (value) => `×${value.toFixed(0)}`,
                onCommit: setTimeScale,
              }}
              hint="Влияет только на скорость проигрывания симуляции"
            />
          </section>

          <section className="control-panel">
            <div className="panel-title">
              <Sparkles size={19} />
              Слои визуализации
            </div>
            <div className="toggle-list">
              <ToggleSwitch label="След траектории" checked={options.showTrail} onChange={() => toggleOption('showTrail')} />
              <ToggleSwitch
                label="Вектор скорости"
                checked={options.showVelocity}
                onChange={() => toggleOption('showVelocity')}
              />
              <ToggleSwitch
                label="Вектор гравитации"
                checked={options.showGravity}
                onChange={() => toggleOption('showGravity')}
              />
              <ToggleSwitch label="Автомасштаб" checked={options.autoScale} onChange={() => toggleOption('autoScale')} />
            </div>
          </section>
        </aside>
      </main>

      <section className="data-panel" aria-label="Таблица изменения величин">
        <div className="data-heading">
          <div>
            <div className="panel-title">
              <Activity size={19} />
              Журнал величин
            </div>
            <p>Новые строки появляются во время полёта и показывают, как меняются параметры тела.</p>
          </div>
          <div className="data-summary">
            <span>e = {telemetry.metrics.eccentricity.toFixed(3)}</span>
            <span>a = {telemetry.metrics.semiMajorAxis ? formatDistance(telemetry.metrics.semiMajorAxis) : '∞'}</span>
            <span>g = {formatAcceleration(telemetry.metrics.acceleration)}</span>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Высота</th>
                <th>Скорость</th>
                <th>Энергия ε</th>
                <th>Ускорение</th>
                <th>Тип траектории</th>
              </tr>
            </thead>
            <tbody>
              {samples.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-row">
                    Нажми «Запустить», чтобы заполнить таблицу измерениями.
                  </td>
                </tr>
              ) : (
                samples.map((row) => (
                  <tr key={`${row.time}-${row.speed}`}>
                    <td>{formatTime(row.time)}</td>
                    <td>{formatDistance(row.altitude)}</td>
                    <td>{formatSpeed(row.speed)}</td>
                    <td>{formatEnergy(row.energy)}</td>
                    <td>{formatAcceleration(row.acceleration)}</td>
                    <td>{row.typeLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type GravityCanvasProps = {
  config: OrbitConfig;
  planets: SimulationPlanet[];
  launchToken: number;
  running: boolean;
  timeScale: number;
  options: DisplayOptions;
  onTelemetry: (telemetry: Telemetry) => void;
  onStop: () => void;
};

type Star = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  phase: number;
  hue: number;
};

type SimStore = {
  engine: ReturnType<typeof createP2Engine>;
  predicted: BodyState[];
  predictedMax: number;
  planetsMax: number;
  trail: BodyState[];
  maxSeen: number;
  cameraRadius: number;
  configRadiusM: number;
  time: number;
  collided: boolean;
  stopSent: boolean;
  lastTelemetry: number;
};

function GravityCanvas({ config, planets, launchToken, running, timeScale, options, onTelemetry, onStop }: GravityCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<SimStore | null>(null);
  const starsRef = useRef<Star[]>([]);
  const latestRef = useRef({ config, planets, running, timeScale, options, onTelemetry, onStop });
  const pendingResetRef = useRef<number | null>(null);
  const skippedInitialConfigResetRef = useRef(false);
  latestRef.current = { config, planets, running, timeScale, options, onTelemetry, onStop };

  const resetSimulation = useCallback(() => {
    const props = latestRef.current;
    const { config: nextConfig, planets: nextPlanets } = props;
    const previous = simRef.current;
    const start = initialState(nextConfig);
    const predicted = predictTrajectory(nextConfig, nextPlanets);
    const { planetsMax, predictedMax } = computeSceneExtents(nextConfig, nextPlanets, predicted);
    const previousCamera = previous
      ? previous.cameraRadius * (nextConfig.radiusM / previous.configRadiusM)
      : nextConfig.radiusM * 3;
    simRef.current = {
      engine: createP2Engine(start),
      predicted,
      predictedMax,
      planetsMax,
      trail: [start],
      maxSeen: nextConfig.radiusM,
      cameraRadius: clamp(previousCamera, nextConfig.radiusM * 2.2, Math.max(nextConfig.radiusM * 12, planetsMax * 1.25)),
      configRadiusM: nextConfig.radiusM,
      time: 0,
      collided: false,
      stopSent: false,
      lastTelemetry: 0,
    };
    props.onTelemetry({
      time: 0,
      state: start,
      metrics: computeMetrics(nextConfig, start, false, nextPlanets),
      collided: false,
    });
  }, []);

  const updatePredictedTrajectory = useCallback(() => {
    const sim = simRef.current;
    if (!sim) {
      return;
    }

    const props = latestRef.current;
    const predicted = predictTrajectory(props.config, props.planets);
    const { planetsMax, predictedMax } = computeSceneExtents(props.config, props.planets, predicted);
    sim.predicted = predicted;
    sim.predictedMax = predictedMax;
    sim.planetsMax = planetsMax;
  }, []);

  useEffect(() => {
    if (pendingResetRef.current !== null) {
      window.clearTimeout(pendingResetRef.current);
      pendingResetRef.current = null;
    }
    resetSimulation();
  }, [launchToken, resetSimulation]);

  useEffect(() => {
    if (!skippedInitialConfigResetRef.current) {
      skippedInitialConfigResetRef.current = true;
      return undefined;
    }

    updatePredictedTrajectory();

    pendingResetRef.current = window.setTimeout(() => {
      pendingResetRef.current = null;
      resetSimulation();
    }, 90);
    return () => {
      if (pendingResetRef.current !== null) {
        window.clearTimeout(pendingResetRef.current);
        pendingResetRef.current = null;
      }
    };
  }, [config, planets, resetSimulation, updatePredictedTrajectory]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      starsRef.current = createStars(rect.width, rect.height);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frameId = 0;
    let lastFrame = performance.now();

    const frame = (now: number) => {
      const props = latestRef.current;
      const sim = simRef.current;
      const rect = canvas.getBoundingClientRect();
      const dtReal = clamp((now - lastFrame) / 1000, 0, 0.05);
      lastFrame = now;

      if (sim && props.running && !sim.collided) {
        const step = stableTimeStep(props.config, props.planets);
        let remaining = dtReal * props.timeScale;
        let guard = 0;

        while (remaining > 0 && guard < 260) {
          const dt = Math.min(step, remaining);
          const state = stepP2Body(sim.engine.satellite, props.planets, dt);
          sim.time += dt;
          sim.maxSeen = Math.max(sim.maxSeen, Math.hypot(state.x, state.y));
          remaining -= dt;
          guard += 1;

          if (findCollidingSource(state, props.planets) && sim.time > step * 2.5) {
            sim.collided = true;
            if (!sim.stopSent) {
              sim.stopSent = true;
              props.onStop();
            }
            break;
          }
        }

        const state = bodyToState(sim.engine.satellite);
        if (sim.trail.length === 0 || distanceBetween(state, sim.trail[sim.trail.length - 1]) > props.config.radiusM * 0.003) {
          sim.trail.push(state);
          if (sim.trail.length > 2600) {
            sim.trail.shift();
          }
        }
      }

      if (sim) {
        drawScene(context, rect.width, rect.height, now, sim, props.config, props.options, props.planets);
        if (now - sim.lastTelemetry > 100) {
          const state = bodyToState(sim.engine.satellite);
          props.onTelemetry({
            time: sim.time,
            state,
            metrics: computeMetrics(props.config, state, sim.collided, props.planets),
            collided: sim.collided,
          });
          sim.lastTelemetry = now;
        }
      }

      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  return <canvas className="orbit-canvas" ref={canvasRef} aria-label="Анимация гравитационного запуска" />;
}

function createStars(width: number, height: number): Star[] {
  const count = Math.floor(clamp((width * height) / 5200, 80, 190));
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    radius: Math.random() * 1.5 + 0.25,
    alpha: Math.random() * 0.55 + 0.18,
    phase: Math.random() * Math.PI * 2,
    hue: Math.random() > 0.78 ? 38 : Math.random() > 0.55 ? 174 : 214,
  }));
}

function distanceBetween(a: BodyState, b: BodyState) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeSceneExtents(config: OrbitConfig, planets: SimulationPlanet[], predicted: BodyState[]) {
  const planetsMax = planets.reduce((max, planet) => Math.max(max, Math.hypot(planet.x, planet.y) + planet.radiusM), config.radiusM);
  const predictedMax = predicted.reduce((max, point) => Math.max(max, Math.hypot(point.x, point.y)), planetsMax);

  return { planetsMax, predictedMax };
}

function drawScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
  sim: SimStore,
  config: OrbitConfig,
  options: DisplayOptions,
  planets: SimulationPlanet[],
) {
  context.clearRect(0, 0, width, height);
  drawBackground(context, width, height, now);

  const state = bodyToState(sim.engine.satellite);
  const compact = width < 560;
  const minimumCamera = config.radiusM * (compact ? 3.2 : 2.2);
  const maximumCamera = Math.max(config.radiusM * 12, sim.planetsMax * 1.25, sim.predictedMax * 0.86, sim.maxSeen * 1.35);
  const desiredCamera = options.autoScale
    ? clamp(
        Math.max(
          config.radiusM * (compact ? 3.45 : 2.45),
          sim.maxSeen * 1.12,
          sim.predictedMax * (compact ? 0.72 : 0.58),
          sim.planetsMax * (compact ? 1.18 : 1.12),
        ),
        minimumCamera,
        maximumCamera,
      )
    : Math.max(config.radiusM * 4.4, sim.planetsMax * 1.08);
  sim.cameraRadius += (desiredCamera - sim.cameraRadius) * 0.045;

  const scale = Math.min(width, height) / (sim.cameraRadius * 2);
  const center = {
    x: width * 0.5,
    y: height * (compact ? 0.45 : 0.53),
  };
  const toScreen = (point: Pick<BodyState, 'x' | 'y'>) => ({
    x: center.x + point.x * scale,
    y: center.y - point.y * scale,
  });

  drawReferenceGrid(context, center, scale, config.radiusM, width, height);
  drawPredictedPath(context, sim.predicted, toScreen);

  if (options.showTrail) {
    drawTrail(context, sim.trail, toScreen);
  }

  planets.forEach((planet, index) => {
    const screen = toScreen(planet);
    const minRadius = index === 0 ? 10 : 7;
    drawPlanet(context, screen, Math.max(minRadius, planet.radiusM * scale), now, planet.visualId);
  });

  drawStartMarker(context, toScreen({ x: config.radiusM, y: 0 }), now);
  drawSatellite(context, toScreen(state), state, config, scale, now, sim.collided);

  if (options.showVelocity) {
    drawVector(context, toScreen(state), state.vx, -state.vy, '#60f0cf', 'v');
  }

  if (options.showGravity) {
    drawGravityVectors(context, toScreen(state), state, planets);
  }

  drawLaunchWave(context, toScreen({ x: config.radiusM, y: 0 }), sim.time, scale, config.radiusM);
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, now: number) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#05070d');
  gradient.addColorStop(0.42, '#071419');
  gradient.addColorStop(1, '#0b0b12');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  for (const star of starsForFrame(width, height)) {
    const twinkle = 0.72 + Math.sin(now * 0.0012 + star.phase) * 0.28;
    context.beginPath();
    context.fillStyle = `hsla(${star.hue}, 95%, 78%, ${star.alpha * twinkle})`;
    context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    context.fill();
  }
}

let lastStarWidth = 0;
let lastStarHeight = 0;
let cachedStars: Star[] = [];

function starsForFrame(width: number, height: number) {
  if (Math.abs(width - lastStarWidth) > 2 || Math.abs(height - lastStarHeight) > 2 || cachedStars.length === 0) {
    cachedStars = createStars(width, height);
    lastStarWidth = width;
    lastStarHeight = height;
  }
  return cachedStars;
}

function drawReferenceGrid(
  context: CanvasRenderingContext2D,
  center: { x: number; y: number },
  scale: number,
  radiusM: number,
  width: number,
  height: number,
) {
  context.save();
  context.strokeStyle = 'rgba(160, 230, 214, 0.11)';
  context.lineWidth = 1;
  context.setLineDash([7, 10]);

  for (let ring = 1; ring <= 5; ring += 1) {
    const radius = radiusM * scale * ring;
    if (radius > Math.max(width, height) * 0.95) {
      break;
    }
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.stroke();
  }

  context.setLineDash([]);
  for (let i = 0; i < 12; i += 1) {
    const angle = (Math.PI * 2 * i) / 12;
    const end = Math.max(width, height);
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(center.x + Math.cos(angle) * end, center.y + Math.sin(angle) * end);
    context.stroke();
  }
  context.restore();
}

function drawPredictedPath(
  context: CanvasRenderingContext2D,
  points: BodyState[],
  toScreen: (point: Pick<BodyState, 'x' | 'y'>) => { x: number; y: number },
) {
  if (points.length < 2) {
    return;
  }

  context.save();
  context.setLineDash([5, 12]);
  context.strokeStyle = 'rgba(255, 219, 139, 0.42)';
  context.lineWidth = 1.4;
  context.beginPath();
  points.forEach((point, index) => {
    const screen = toScreen(point);
    if (index === 0) {
      context.moveTo(screen.x, screen.y);
    } else {
      context.lineTo(screen.x, screen.y);
    }
  });
  context.stroke();
  context.restore();
}

function drawTrail(
  context: CanvasRenderingContext2D,
  points: BodyState[],
  toScreen: (point: Pick<BodyState, 'x' | 'y'>) => { x: number; y: number },
) {
  if (points.length < 2) {
    return;
  }

  context.save();
  context.lineCap = 'round';
  for (let i = 1; i < points.length; i += 1) {
    const a = toScreen(points[i - 1]);
    const b = toScreen(points[i]);
    const progress = i / points.length;
    context.strokeStyle = `rgba(83, 232, 205, ${0.08 + progress * 0.55})`;
    context.lineWidth = 1.2 + progress * 3.2;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  context.restore();
}

function drawPlanet(
  context: CanvasRenderingContext2D,
  center: { x: number; y: number },
  radius: number,
  now: number,
  visualId: PlanetVisualId,
) {
  const visual = planetVisuals[visualId] ?? planetVisuals.custom;

  if (visual.ring) {
    drawPlanetRing(context, center, radius, visual.ring, now, 'back');
  }

  context.save();
  context.shadowColor = visual.glow;
  context.shadowBlur = Math.max(18, radius * 0.25);
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fillStyle = visual.haze;
  context.fill();
  context.shadowBlur = 0;

  const planet = context.createRadialGradient(
    center.x - radius * 0.35,
    center.y - radius * 0.42,
    radius * 0.08,
    center.x,
    center.y,
    radius,
  );
  visual.stops.forEach(([position, color]) => planet.addColorStop(position, color));
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fillStyle = planet;
  context.fill();

  context.clip();
  const phase = now * 0.00012;

  if (visual.bandCount > 0) {
    context.globalAlpha = visual.bandAlpha;
    context.strokeStyle = visual.bandColor;
    context.lineWidth = Math.max(1, radius * (visualId === 'jupiter' ? 0.018 : 0.012));
    const half = (visual.bandCount - 1) / 2;
    for (let index = 0; index < visual.bandCount; index += 1) {
      const offset = index - half;
      const normalized = half === 0 ? 0 : offset / half;
      context.beginPath();
      context.ellipse(
        center.x + Math.sin(phase + index) * radius * 0.1,
        center.y + normalized * radius * 0.68,
        radius * (0.78 - Math.abs(normalized) * 0.08),
        radius * (visualId === 'jupiter' ? 0.085 : 0.105),
        visual.bandTilt + Math.sin(phase) * 0.06,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
  }

  if (visual.spots) {
    visual.spots.forEach((spot) => {
      context.globalAlpha = spot.alpha;
      context.fillStyle = spot.color;
      context.beginPath();
      context.ellipse(
        center.x + spot.x * radius,
        center.y + spot.y * radius,
        spot.rx * radius,
        spot.ry * radius,
        visual.bandTilt * 0.7,
        0,
        Math.PI * 2,
      );
      context.fill();
    });
  }

  context.globalAlpha = 0.18;
  context.fillStyle = visual.shadow;
  context.beginPath();
  context.ellipse(center.x + radius * 0.48, center.y + radius * 0.1, radius * 0.78, radius * 1.08, -0.22, 0, Math.PI * 2);
  context.fill();
  context.restore();

  if (visual.ring) {
    drawPlanetRing(context, center, radius, visual.ring, now, 'front');
  }
}

function drawPlanetRing(
  context: CanvasRenderingContext2D,
  center: { x: number; y: number },
  radius: number,
  ring: { color: string; shadow: string },
  now: number,
  layer: 'back' | 'front',
) {
  context.save();
  context.translate(center.x, center.y);
  context.rotate(-0.18 + Math.sin(now * 0.0001) * 0.015);
  context.shadowColor = ring.shadow;
  context.shadowBlur = radius * 0.12;
  context.strokeStyle = ring.color;
  context.lineWidth = Math.max(4, radius * 0.11);
  context.beginPath();
  if (layer === 'front') {
    context.ellipse(0, 0, radius * 1.65, radius * 0.36, 0, 0.04 * Math.PI, 0.96 * Math.PI);
  } else {
    context.ellipse(0, 0, radius * 1.65, radius * 0.36, 0, 0, Math.PI * 2);
  }
  context.stroke();
  context.shadowBlur = 0;
  context.strokeStyle = 'rgba(90, 64, 36, 0.35)';
  context.lineWidth = Math.max(1.5, radius * 0.022);
  context.beginPath();
  context.ellipse(0, 0, radius * 1.42, radius * 0.3, 0, layer === 'front' ? 0.04 * Math.PI : 0, layer === 'front' ? 0.96 * Math.PI : Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawStartMarker(context: CanvasRenderingContext2D, point: { x: number; y: number }, now: number) {
  const pulse = 1 + Math.sin(now * 0.005) * 0.18;
  context.save();
  context.strokeStyle = 'rgba(255, 198, 95, 0.82)';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(point.x, point.y, 9 * pulse, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = '#ffd17d';
  context.beginPath();
  context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawSatellite(
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
  state: BodyState,
  config: OrbitConfig,
  scale: number,
  now: number,
  collided: boolean,
) {
  const speed = Math.hypot(state.vx, state.vy);
  const glow = 12 + Math.sin(now * 0.008) * 2 + clamp(speed / Math.sqrt((config.massKg * G) / config.radiusM), 0, 2) * 4;
  context.save();
  context.shadowColor = collided ? 'rgba(255, 92, 122, 0.95)' : 'rgba(105, 244, 217, 0.92)';
  context.shadowBlur = glow;
  context.fillStyle = collided ? '#ff5c7a' : '#eafffb';
  context.beginPath();
  context.arc(point.x, point.y, Math.max(4.5, config.radiusM * scale * 0.026), 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = collided ? '#ffb3c0' : '#56e1c8';
  context.lineWidth = 1.6;
  context.beginPath();
  context.arc(point.x, point.y, Math.max(9, config.radiusM * scale * 0.05), 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawGravityVectors(
  context: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  state: BodyState,
  planets: SimulationPlanet[],
) {
  const vectors = planets
    .map((planet, index) => {
      const dx = planet.x - state.x;
      const dy = planet.y - state.y;
      const distanceSquared = Math.max(dx * dx + dy * dy, 1);
      return {
        dx,
        dy,
        index,
        acceleration: (G * planet.massKg) / distanceSquared,
      };
    })
    .filter((vector) => Number.isFinite(vector.acceleration) && vector.acceleration > 0);

  const strongest = vectors.reduce((max, vector) => Math.max(max, vector.acceleration), 0);
  if (strongest <= 0) {
    return;
  }

  vectors.forEach((vector) => {
    const relativeStrength = Math.sqrt(vector.acceleration / strongest);
    const length = clamp(18 + relativeStrength * 78, 18, 98);
    const alpha = clamp(0.4 + relativeStrength * 0.52, 0.4, 0.92);
    drawVector(
      context,
      origin,
      vector.dx,
      -vector.dy,
      gravityVectorColors[vector.index % gravityVectorColors.length],
      planets.length > 1 ? `g${vector.index + 1}` : 'g',
      1,
      length,
      alpha,
    );
  });
}

function drawVector(
  context: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  vx: number,
  vy: number,
  color: string,
  label: string,
  multiplier = 1,
  fixedLength?: number,
  alpha = 1,
) {
  const magnitude = Math.hypot(vx, vy);
  if (magnitude <= 0) {
    return;
  }
  const length = fixedLength ?? clamp(Math.log10(magnitude + 10) * 16 * multiplier, 22, 86);
  const nx = vx / magnitude;
  const ny = vy / magnitude;
  const end = {
    x: origin.x + nx * length,
    y: origin.y + ny * length,
  };

  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(origin.x, origin.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - nx * 10 - ny * 5, end.y - ny * 10 + nx * 5);
  context.lineTo(end.x - nx * 10 + ny * 5, end.y - ny * 10 - nx * 5);
  context.closePath();
  context.fill();
  context.font = '600 12px Inter, system-ui, sans-serif';
  context.fillText(label, end.x + 6, end.y - 6);
  context.restore();
}

function drawLaunchWave(context: CanvasRenderingContext2D, origin: { x: number; y: number }, time: number, scale: number, radiusM: number) {
  if (time <= 0) {
    return;
  }
  const progress = clamp(time / 210, 0, 1);
  if (progress >= 1) {
    return;
  }
  context.save();
  context.strokeStyle = `rgba(255, 202, 114, ${0.58 * (1 - progress)})`;
  context.lineWidth = 2 + progress * 4;
  context.beginPath();
  context.arc(origin.x, origin.y, radiusM * scale * 0.08 + progress * 90, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

type MetricCardProps = {
  icon: ReactElement;
  label: string;
  value: string;
  detail: string;
};

function MetricCard({ icon, label, value, detail }: MetricCardProps) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

type SliderFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  readout: string;
  hint: string;
  onChange: (value: number) => void;
  editable?: {
    value: number;
    min: number;
    max: number;
    step: number;
    ariaLabel: string;
    format: (value: number) => string;
    onCommit: (value: number) => void;
  };
};

function formatEditableDraft(value: number, step: number) {
  if (step >= 1) {
    return String(Math.round(value));
  }

  const precision = Math.min(4, Math.max(1, Math.ceil(Math.abs(Math.log10(step)))));
  return value.toFixed(precision).replace(/\.?0+$/, '');
}

function SliderField({ label, value, min, max, step, readout, hint, onChange, editable }: SliderFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() => (editable ? formatEditableDraft(editable.value, editable.step) : ''));
  const progress = ((value - min) / (max - min)) * 100;

  useEffect(() => {
    if (!isEditing && editable) {
      setDraft(formatEditableDraft(editable.value, editable.step));
    }
  }, [editable?.step, editable?.value, isEditing]);

  const commitDraft = () => {
    if (!editable) {
      return;
    }

    const parsed = Number(draft.trim().replace(',', '.'));
    if (Number.isFinite(parsed)) {
      const next = clamp(parsed, editable.min, editable.max);
      editable.onCommit(next);
      setDraft(formatEditableDraft(next, editable.step));
    } else {
      setDraft(formatEditableDraft(editable.value, editable.step));
    }
    setIsEditing(false);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }

    if (event.key === 'Escape') {
      setDraft(editable ? formatEditableDraft(editable.value, editable.step) : '');
      setIsEditing(false);
    }
  };

  return (
    <div className="slider-field">
      <span className="slider-top">
        <span>{label}</span>
        {editable && isEditing ? (
          <input
            className="readout-input"
            type="number"
            min={editable.min}
            max={editable.max}
            step={editable.step}
            value={draft}
            aria-label={editable.ariaLabel}
            autoFocus
            onBlur={commitDraft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.target.select()}
            onKeyDown={handleInputKeyDown}
          />
        ) : editable ? (
          <button
            className="readout-button"
            type="button"
            aria-label={editable.ariaLabel}
            onClick={() => {
              setDraft(formatEditableDraft(editable.value, editable.step));
              setIsEditing(true);
            }}
          >
            {readout}
          </button>
        ) : (
          <strong>{readout}</strong>
        )}
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--progress': `${progress}%` } as CSSProperties}
      />
      <span className="hint">{hint}</span>
    </div>
  );
}

type ToggleSwitchProps = {
  label: string;
  checked: boolean;
  onChange: () => void;
};

function ToggleSwitch({ label, checked, onChange }: ToggleSwitchProps) {
  return (
    <button className={`toggle-switch ${checked ? 'active' : ''}`} type="button" onClick={onChange} aria-pressed={checked}>
      <span className="switch-track">
        <span />
      </span>
      <span>{label}</span>
    </button>
  );
}

export default App;
