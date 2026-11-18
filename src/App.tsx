import { useDeferredValue, useMemo } from 'react';
import { MonsterSearch } from './components/MonsterSearch';
import { Panel } from './components/Panel';
import { PointsInput } from './components/PointsInput';
import { PrioritySlider } from './components/PrioritySlider';
import { ResultsPanel } from './components/ResultsPanel';
import { VocationPicker } from './components/VocationPicker';
import { WheelChart } from './components/WheelChart';
import { usePersistentInputs } from './hooks/usePersistentInputs';
import { getMonsterById, getWheel, optimize, useMonsterData } from './lib/api';
import { VOCATION_LABELS } from './lib/labels';

export default function App() {
  const [inputs, update] = usePersistentInputs();
  const monstersReady = useMonsterData();
  const deferred = useDeferredValue(inputs);

  const wheel = useMemo(() => getWheel(inputs.vocation), [inputs.vocation]);
  const maxPoints = wheel.totalCapacity;
  const monster = useMemo(
    () => (monstersReady && inputs.monsterId ? (getMonsterById(inputs.monsterId) ?? null) : null),
    [inputs.monsterId, monstersReady],
  );

  const points = Math.min(deferred.points, maxPoints);
  const deferredMonster = useMemo(
    () => (monstersReady && deferred.monsterId ? (getMonsterById(deferred.monsterId) ?? null) : null),
    [deferred.monsterId, monstersReady],
  );
  const result = useMemo(
    () =>
      points > 0
        ? optimize({ vocation: deferred.vocation, points, monster: deferredMonster, priority: deferred.priority })
        : null,
    [deferred.vocation, points, deferredMonster, deferred.priority],
  );
  const resultWheel = useMemo(() => getWheel(deferred.vocation), [deferred.vocation]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <header className="mb-6 text-center sm:mb-8">
        <h1 className="font-display text-2xl font-bold tracking-wide text-gold-300 sm:text-3xl">
          Wheel of Destiny Optimizer
        </h1>
        <p className="mt-1 text-sm text-parchment-300">
          Pick a vocation, your points and a target — get a suggested Tibia wheel build.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4">
          <VocationPicker value={inputs.vocation} onChange={(vocation) => update({ vocation })} />
          <PointsInput value={inputs.points} max={maxPoints} onChange={(p) => update({ points: p })} />
          <MonsterSearch value={monster} ready={monstersReady} onChange={(m) => update({ monsterId: m?.id ?? null })} />
          <PrioritySlider value={inputs.priority} onChange={(priority) => update({ priority })} />
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          <Panel title={`${VOCATION_LABELS[deferred.vocation]} wheel`} headingId="wheel-heading">
            <WheelChart wheel={resultWheel} result={result} />
          </Panel>
          <Panel title="Build summary" headingId="results-heading">
            <div aria-live="polite">
              {result ? (
                <ResultsPanel wheel={resultWheel} result={result} />
              ) : (
                <p className="py-6 text-center text-sm text-parchment-300">
                  Enter your promotion points (or character level) to see an optimized build.
                </p>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <footer className="mt-10 text-center text-xs text-parchment-400">
        Fan-made tool. Tibia is a trademark of CipSoft GmbH. Monster data from tibiopedia.pl.
      </footer>
    </div>
  );
}
