import { useDeferredValue, useMemo } from 'react';
import { CharacterPanel } from './components/CharacterPanel';
import { ExportPanel } from './components/ExportPanel';
import { FightContextPanel } from './components/FightContextPanel';
import { GemsPanel } from './components/GemsPanel';
import { LanguageSwitch } from './components/LanguageSwitch';
import { MonsterSearch } from './components/MonsterSearch';
import { Panel } from './components/Panel';
import { PrioritySlider } from './components/PrioritySlider';
import { ResultsPanel } from './components/ResultsPanel';
import { RotationPanel } from './components/RotationPanel';
import { VesselsPanel } from './components/VesselsPanel';
import { VocationPicker } from './components/VocationPicker';
import { WheelChart } from './components/WheelChart';
import { usePersistentGems } from './hooks/usePersistentGems';
import { gemFromRecommendation, setModGrade } from './lib/gems';
import { usePersistentInputs } from './hooks/usePersistentInputs';
import { usePersistentSpellPrefs } from './hooks/usePersistentSpellPrefs';
import { useT } from './i18n';
import { getForceableSpells, getMonsterById, getRotationPresets, getStanceOptions, getWheel, optimize, revelationOptions, useMonsterData } from './lib/api';
import { stanceNames } from './lib/spellPrefs';
import type { BuildResult } from './lib/api';
import { characterOf, contextOf } from './lib/inputState';
import { resolveMonsters } from './lib/monsters';
import { emptyUnlockedByQuality } from './lib/vessels';
import { VOCATION_LABELS } from './lib/labels';

export default function App() {
  const t = useT();
  const [inputs, update] = usePersistentInputs();
  const [gems, setGems] = usePersistentGems(inputs.vocation);
  const [spellPrefs, updateSpellPrefs] = usePersistentSpellPrefs(inputs.vocation);
  const deferredPrefs = useDeferredValue(spellPrefs);
  const presets = useMemo(() => getRotationPresets(inputs.vocation), [inputs.vocation]);
  const forceable = useMemo(() => getForceableSpells(inputs.vocation), [inputs.vocation]);
  const stanceOptions = useMemo(() => getStanceOptions(inputs.vocation), [inputs.vocation]);
  const monstersReady = useMonsterData();
  const deferred = useDeferredValue(inputs);
  const deferredGems = useDeferredValue(gems);

  const wheel = useMemo(() => getWheel(inputs.vocation), [inputs.vocation]);
  const maxPoints = wheel.totalCapacity;
  const spot = useMemo(
    () => (monstersReady ? resolveMonsters(inputs.monsters, getMonsterById) : []),
    [inputs.monsters, monstersReady],
  );
  const context = useMemo(() => contextOf(inputs), [inputs]);

  const points = Math.min(deferred.points, maxPoints);
  const deferredSpot = useMemo(
    () => (monstersReady ? resolveMonsters(deferred.monsters, getMonsterById) : []),
    [deferred.monsters, monstersReady],
  );
  const character = useMemo(() => characterOf(deferred), [deferred]);
  const { mode } = deferred;
  const { rotationId, forcedSpells, forcedStage2, forcedRevelations, stance } = deferredPrefs;
  const revelationReach = useMemo(
    () => revelationOptions({ vocation: deferred.vocation, points, gems: deferredGems, character }),
    [deferred.vocation, points, deferredGems, character],
  );
  const result = useMemo(
    () =>
      points > 0
        ? optimize({
            vocation: deferred.vocation,
            points,
            monster: null,
            monsters: deferredSpot,
            priority: deferred.priority,
            context: { mode },
            gems: deferredGems,
            character,
            alternatives: 0,
            rotationId: rotationId ?? undefined,
            forcedSpells: forcedSpells.length ? forcedSpells : undefined,
            forcedStage2: forcedStage2.length ? forcedStage2 : undefined,
            forcedRevelations: forcedRevelations.length ? forcedRevelations : undefined,
            stances: stance === null ? undefined : stanceNames(stance),
          })
        : null,
    [deferred.vocation, points, deferredSpot, deferred.priority, mode, deferredGems, character, rotationId, forcedSpells, forcedStage2, forcedRevelations, stance],
  );
  const resultWheel = useMemo(() => getWheel(deferred.vocation), [deferred.vocation]);
  const shown: BuildResult | null = result;
  const emptyVessels = useMemo(
    () => (shown && deferred.vocation === inputs.vocation ? emptyUnlockedByQuality(shown.vessels) : null),
    [shown, deferred.vocation, inputs.vocation],
  );

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
          <CharacterPanel vocation={inputs.vocation} value={inputs} max={maxPoints} onChange={update} />
          <MonsterSearch value={spot} ready={monstersReady} onChange={(monsters) => update({ monsters })} />
          <FightContextPanel value={context} onChange={update} />
          <PrioritySlider value={inputs.priority} onChange={(priority) => update({ priority })} />
          <GemsPanel vocation={inputs.vocation} gems={gems} mods={wheel.mods} emptyVessels={emptyVessels} onChange={setGems} />
        </div>

        <div className="flex flex-col gap-4">
          <Panel title={t('app.wheelTitle', { vocation: VOCATION_LABELS[deferred.vocation] })} headingId="wheel-heading">
            {gems.length === 0 && (
              <p role="note" className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {t('app.noGems')}{' '}
                <a href="#gems-heading" className="font-medium text-gold-300 underline hover:text-gold-200">{t('app.noGemsLink')}</a>
              </p>
            )}
            <WheelChart wheel={resultWheel} result={shown} />
          </Panel>
          <Panel title={t('rotation.title')} headingId="rotation-heading">
            <RotationPanel
              presets={presets}
              spells={forceable}
              stanceOptions={stanceOptions}
              revelations={revelationReach}
              value={spellPrefs}
              onChange={updateSpellPrefs}
              usage={deferred.vocation === inputs.vocation ? shown?.rotation : undefined}
              stances={deferred.vocation === inputs.vocation ? shown?.stances : undefined}
            />
          </Panel>
          <Panel title={t('app.summaryTitle')} headingId="results-heading">
            <div aria-live="polite">
              {shown ? (
                <ResultsPanel wheel={resultWheel} result={shown} />
              ) : (
                <p className="py-6 text-center text-sm text-parchment-300">{t('app.empty')}</p>
              )}
            </div>
          </Panel>
          {shown && (
            <Panel title={t('export.title')} headingId="export-heading">
              <ExportPanel key={shown.plannerCode ?? ''} code={shown.plannerCode} />
            </Panel>
          )}
          {shown && (
            <Panel title={t('vessels.title')} headingId="vessels-heading">
              <VesselsPanel
                vocation={deferred.vocation}
                result={shown}
                mods={resultWheel.mods}
                onAddGem={deferred.vocation === inputs.vocation ? (rec) => setGems((all) => [...all, gemFromRecommendation(rec, all)]) : undefined}
                onUpgrade={deferred.vocation === inputs.vocation ? (u) => setGems((all) => setModGrade(all, u.kind, u.modId, u.toGrade)) : undefined}
              />
            </Panel>
          )}
        </div>
      </div>

      <footer className="mt-10 text-center text-xs text-parchment-400">
        {t('app.footer')}{' '}
        <a href="./third-party-licenses.txt" className="underline hover:text-parchment-200">
          {t('app.licenses')}
        </a>
      </footer>
    </div>
  );
}
