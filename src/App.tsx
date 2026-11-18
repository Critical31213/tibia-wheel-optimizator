import { useDeferredValue, useMemo } from 'react';
import { FightContextPanel } from './components/FightContextPanel';
import { GemsPanel } from './components/GemsPanel';
import { LanguageSwitch } from './components/LanguageSwitch';
import { MonsterSearch } from './components/MonsterSearch';
import { Panel } from './components/Panel';
import { PointsInput } from './components/PointsInput';
import { PrioritySlider } from './components/PrioritySlider';
import { ResultsPanel } from './components/ResultsPanel';
import { VesselsPanel } from './components/VesselsPanel';
import { VocationPicker } from './components/VocationPicker';
import { WheelChart } from './components/WheelChart';
import { usePersistentGems } from './hooks/usePersistentGems';
import { usePersistentInputs } from './hooks/usePersistentInputs';
import { useT } from './i18n';
import { getMonsterById, getWheel, optimize, useMonsterData } from './lib/api';
import { modsWithDevFallback } from './lib/devFixtures';
import { contextOf } from './lib/inputState';
import { VOCATION_LABELS } from './lib/labels';

export default function App() {
  const t = useT();
  const [inputs, update] = usePersistentInputs();
  const [gems, setGems] = usePersistentGems(inputs.vocation);
  const monstersReady = useMonsterData();
  const deferred = useDeferredValue(inputs);
  const deferredGems = useDeferredValue(gems);

  const wheel = useMemo(() => getWheel(inputs.vocation), [inputs.vocation]);
  const { mods, isFixture } = useMemo(() => modsWithDevFallback(wheel), [wheel]);
  const maxPoints = wheel.totalCapacity;
  const monster = useMemo(
    () => (monstersReady && inputs.monsterId ? (getMonsterById(inputs.monsterId) ?? null) : null),
    [inputs.monsterId, monstersReady],
  );
  const context = useMemo(() => contextOf(inputs), [inputs]);

  const points = Math.min(deferred.points, maxPoints);
  const deferredMonster = useMemo(
    () => (monstersReady && deferred.monsterId ? (getMonsterById(deferred.monsterId) ?? null) : null),
    [deferred.monsterId, monstersReady],
  );
  const { mode, huntStyle } = deferred;
  const result = useMemo(
    () =>
      points > 0
        ? optimize({
            vocation: deferred.vocation,
            points,
            monster: deferredMonster,
            priority: deferred.priority,
            context: { mode, huntStyle },
            gems: deferredGems,
          })
        : null,
    [deferred.vocation, points, deferredMonster, deferred.priority, mode, huntStyle, deferredGems],
  );
  const resultWheel = useMemo(() => getWheel(deferred.vocation), [deferred.vocation]);
  const resultMods = useMemo(() => modsWithDevFallback(resultWheel).mods, [resultWheel]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <header className="relative mb-6 pt-8 text-center sm:mb-8 sm:pt-0">
        <LanguageSwitch className="absolute top-0 right-0 w-20" />
        <h1 className="font-display text-2xl font-bold tracking-wide text-gold-300 sm:px-24 sm:text-3xl">{t('app.title')}</h1>
        <p className="mt-1 text-sm text-parchment-300">{t('app.subtitle')}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4">
          <VocationPicker value={inputs.vocation} onChange={(vocation) => update({ vocation })} />
          <PointsInput value={inputs.points} max={maxPoints} onChange={(p) => update({ points: p })} />
          <MonsterSearch value={monster} ready={monstersReady} onChange={(m) => update({ monsterId: m?.id ?? null })} />
          <FightContextPanel value={context} onChange={update} />
          <PrioritySlider value={inputs.priority} onChange={(priority) => update({ priority })} />
          <GemsPanel vocation={inputs.vocation} gems={gems} mods={mods} isFixture={isFixture} onChange={setGems} />
        </div>

        <div className="flex flex-col gap-4">
          <Panel title={t('app.wheelTitle', { vocation: VOCATION_LABELS[deferred.vocation] })} headingId="wheel-heading">
            <WheelChart wheel={resultWheel} result={result} />
          </Panel>
          <Panel title={t('app.summaryTitle')} headingId="results-heading">
            <div aria-live="polite">
              {result ? (
                <ResultsPanel wheel={resultWheel} result={result} />
              ) : (
                <p className="py-6 text-center text-sm text-parchment-300">{t('app.empty')}</p>
              )}
            </div>
          </Panel>
          {result && (
            <Panel title={t('vessels.title')} headingId="vessels-heading">
              <VesselsPanel vocation={deferred.vocation} result={result} mods={resultMods} />
            </Panel>
          )}
        </div>
      </div>

      <footer className="mt-10 text-center text-xs text-parchment-400">{t('app.footer')}</footer>
    </div>
  );
}
