import {
  Activity,
  Atom,
  Gauge,
  Orbit,
  Pause,
  Play,
  Radar,
  RotateCcw,
  Satellite,
  Settings2,
  Sparkles,
  Timer,
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
  OrbitConfig,
  OrbitMetrics,
  bodyToState,
  clamp,
  computeMetrics,
  cosmicSpeeds,
  createP2Engine,
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

const earthMassE24 = EARTH_MASS_KG / 1e24;
const earthRadiusKm = EARTH_RADIUS_M / 1000;

const planetPresets = [
  { id: 'mercury', name: 'Меркурий', massE24: 0.33011, radiusKm: 2439.7 },
  { id: 'venus', name: 'Венера', massE24: 4.8675, radiusKm: 6051.8 },
  { id: 'earth', name: 'Земля', massE24: earthMassE24, radiusKm: earthRadiusKm },
  { id: 'mars', name: 'Марс', massE24: 0.64171, radiusKm: 3389.5 },
  { id: 'jupiter', name: 'Юпитер', massE24: 1898.13, radiusKm: 69911 },
  { id: 'saturn', name: 'Сатурн', massE24: 568.32, radiusKm: 58232 },
  { id: 'uranus', name: 'Уран', massE24: 86.811, radiusKm: 25362 },
  { id: 'neptune', name: 'Нептун', massE24: 102.409, radiusKm: 24622 },
];

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

function App() {
  const [planetMassE24, setPlanetMassE24] = useState(earthMassE24);
  const [planetRadiusKm, setPlanetRadiusKm] = useState(earthRadiusKm);
  const [speedRatio, setSpeedRatio] = useState(1);
  const [angleDeg, setAngleDeg] = useState(0);
  const [timeScale, setTimeScale] = useState(720);
  const [isRunning, setIsRunning] = useState(false);
  const [launchToken, setLaunchToken] = useState(0);
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [options, setOptions] = useState<DisplayOptions>({
    showTrail: true,
    showVelocity: true,
    showGravity: true,
    autoScale: true,
  });

  const massKg = planetMassE24 * 1e24;
  const radiusM = planetRadiusKm * 1000;
  const selectedPlanetPreset = useMemo(() => {
    const match = planetPresets.find(
      (planet) => Math.abs(planet.massE24 - planetMassE24) < 0.0005 && Math.abs(planet.radiusKm - planetRadiusKm) < 0.05,
    );
    return match?.id ?? 'custom';
  }, [planetMassE24, planetRadiusKm]);
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
  const initialTelemetry = useMemo<Telemetry>(() => {
    const state = initialState(config);
    return {
      time: 0,
      state,
      metrics: computeMetrics(config, state),
      collided: false,
    };
  }, [config]);
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
    setSpeedRatio(1);
    setAngleDeg(0);
    setTimeScale(720);
    setIsRunning(false);
    setLaunchToken((value) => value + 1);
  };

  const selectPlanetPreset = (presetId: string) => {
    const preset = planetPresets.find((planet) => planet.id === presetId);
    if (!preset) {
      return;
    }

    setPlanetMassE24(preset.massE24);
    setPlanetRadiusKm(preset.radiusKm);
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
              detail={telemetry.metrics.specificEnergy < 0 ? 'связана с планетой' : 'уход возможен'}
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
              min={-20}
              max={55}
              step={0.1}
              onChange={setAngleDeg}
              readout={`${angleDeg.toFixed(1)}°`}
              editable={{
                value: angleDeg,
                min: -20,
                max: 55,
                step: 0.1,
                ariaLabel: 'Ввести угол запуска',
                format: (value) => `${value.toFixed(1)}°`,
                onCommit: setAngleDeg,
              }}
              hint="0° — горизонтально по касательной; плюс — от планеты"
            />
          </section>

          <section className="control-panel">
            <div className="panel-title">
              <Settings2 size={19} />
              Планета и время
            </div>
            <label className="select-field">
              <span>Готовая планета</span>
              <select value={selectedPlanetPreset} onChange={(event) => selectPlanetPreset(event.target.value)}>
                <option value="custom">Своя планета</option>
                {planetPresets.map((planet) => (
                  <option key={planet.id} value={planet.id}>
                    {planet.name}
                  </option>
                ))}
              </select>
            </label>
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
  trail: BodyState[];
  maxSeen: number;
  cameraRadius: number;
  configRadiusM: number;
  time: number;
  collided: boolean;
  stopSent: boolean;
  lastTelemetry: number;
};

function GravityCanvas({ config, launchToken, running, timeScale, options, onTelemetry, onStop }: GravityCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<SimStore | null>(null);
  const starsRef = useRef<Star[]>([]);
  const latestRef = useRef({ config, running, timeScale, options, onTelemetry, onStop });
  latestRef.current = { config, running, timeScale, options, onTelemetry, onStop };

  const resetSimulation = useCallback(() => {
    const previous = simRef.current;
    const start = initialState(config);
    const predicted = predictTrajectory(config);
    const predictedMax = predicted.reduce((max, point) => Math.max(max, Math.hypot(point.x, point.y)), config.radiusM);
    const previousCamera = previous
      ? previous.cameraRadius * (config.radiusM / previous.configRadiusM)
      : config.radiusM * 3;
    simRef.current = {
      engine: createP2Engine(start),
      predicted,
      predictedMax,
      trail: [start],
      maxSeen: config.radiusM,
      cameraRadius: clamp(previousCamera, config.radiusM * 2.2, config.radiusM * 12),
      configRadiusM: config.radiusM,
      time: 0,
      collided: false,
      stopSent: false,
      lastTelemetry: 0,
    };
    onTelemetry({
      time: 0,
      state: start,
      metrics: computeMetrics(config, start),
      collided: false,
    });
  }, [config, onTelemetry]);

  useEffect(() => {
    resetSimulation();
  }, [launchToken, resetSimulation]);

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
        const step = stableTimeStep(props.config);
        let remaining = dtReal * props.timeScale;
        let guard = 0;

        while (remaining > 0 && guard < 260) {
          const dt = Math.min(step, remaining);
          const state = stepP2Body(sim.engine.satellite, props.config.massKg * G, dt);
          sim.time += dt;
          sim.maxSeen = Math.max(sim.maxSeen, Math.hypot(state.x, state.y));
          remaining -= dt;
          guard += 1;

          const metrics = computeMetrics(props.config, state);
          if (metrics.r < props.config.radiusM * 0.9985 && sim.time > step * 2.5) {
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
        drawScene(context, rect.width, rect.height, now, sim, props.config, props.options);
        if (now - sim.lastTelemetry > 100) {
          const state = bodyToState(sim.engine.satellite);
          props.onTelemetry({
            time: sim.time,
            state,
            metrics: computeMetrics(props.config, state, sim.collided),
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

function drawScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
  sim: SimStore,
  config: OrbitConfig,
  options: DisplayOptions,
) {
  context.clearRect(0, 0, width, height);
  drawBackground(context, width, height, now);

  const state = bodyToState(sim.engine.satellite);
  const compact = width < 560;
  const desiredCamera = options.autoScale
    ? clamp(
        Math.max(config.radiusM * (compact ? 3.45 : 2.45), sim.maxSeen * 1.12, sim.predictedMax * (compact ? 0.72 : 0.58)),
        config.radiusM * (compact ? 3.2 : 2.2),
        config.radiusM * 12,
      )
    : config.radiusM * 4.4;
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

  drawPlanet(context, center, config.radiusM * scale, now);
  drawStartMarker(context, toScreen({ x: config.radiusM, y: 0 }), now);
  drawSatellite(context, toScreen(state), state, config, scale, now, sim.collided);

  if (options.showVelocity) {
    drawVector(context, toScreen(state), state.vx, -state.vy, '#60f0cf', 'v');
  }

  if (options.showGravity) {
    drawVector(context, toScreen(state), -state.x, state.y, '#ffbd63', 'g', 0.78);
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

function drawPlanet(context: CanvasRenderingContext2D, center: { x: number; y: number }, radius: number, now: number) {
  context.save();
  context.shadowColor = 'rgba(69, 210, 191, 0.58)';
  context.shadowBlur = Math.max(18, radius * 0.25);
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fillStyle = 'rgba(63, 218, 195, 0.24)';
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
  planet.addColorStop(0, '#d8fff5');
  planet.addColorStop(0.18, '#7df1d7');
  planet.addColorStop(0.48, '#217c85');
  planet.addColorStop(0.76, '#123c63');
  planet.addColorStop(1, '#07131f');
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fillStyle = planet;
  context.fill();

  context.clip();
  context.globalAlpha = 0.32;
  context.strokeStyle = '#f1c36a';
  context.lineWidth = Math.max(1, radius * 0.012);
  const phase = now * 0.00012;
  for (let i = -3; i <= 3; i += 1) {
    context.beginPath();
    context.ellipse(
      center.x + Math.sin(phase + i) * radius * 0.12,
      center.y + (i * radius) / 5,
      radius * (0.78 - Math.abs(i) * 0.055),
      radius * 0.12,
      Math.sin(phase) * 0.18,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }

  context.globalAlpha = 0.18;
  context.fillStyle = '#07131f';
  context.beginPath();
  context.ellipse(center.x + radius * 0.48, center.y + radius * 0.1, radius * 0.78, radius * 1.08, -0.22, 0, Math.PI * 2);
  context.fill();
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

function drawVector(
  context: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  vx: number,
  vy: number,
  color: string,
  label: string,
  multiplier = 1,
) {
  const magnitude = Math.hypot(vx, vy);
  if (magnitude <= 0) {
    return;
  }
  const length = clamp(Math.log10(magnitude + 10) * 16 * multiplier, 22, 86);
  const nx = vx / magnitude;
  const ny = vy / magnitude;
  const end = {
    x: origin.x + nx * length,
    y: origin.y + ny * length,
  };

  context.save();
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
