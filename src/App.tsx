import { useDeferredValue, useMemo } from 'react';
import { useOptimizer } from './hooks/useOptimizer';
import { CharacterPanel } from './components/CharacterPanel';
import { DebugCopy } from './components/DebugCopy';
import { ExportPanel } from './components/ExportPanel';
import { FightContextPanel } from './components/FightContextPanel';
import { GemsPanel } from './components/GemsPanel';
import { LanguageSwitch } from './components/LanguageSwitch';
import { MonsterSearch } from './components/MonsterSearch';
import { NotesPanel } from './components/NotesPanel';
import { Panel } from './components/Panel';
import { BuildRationale, ResultsPanel } from './components/ResultsPanel';
import { RotationPanel } from './components/RotationPanel';
import { VesselsPanel } from './components/VesselsPanel';
import { VocationPicker } from './components/VocationPicker';
import { WeaponResultPanel } from './components/WeaponResultPanel';
import { WeaponsPanel } from './components/WeaponsPanel';
import { WheelChart } from './components/WheelChart';
import { usePersistentGems } from './hooks/usePersistentGems';
import { gemFromRecommendation, setModGrade } from './lib/gems';
import { usePersistentInputs } from './hooks/usePersistentInputs';
import { usePersistentSpellPrefs } from './hooks/usePersistentSpellPrefs';
import { usePersistentWeapons } from './hooks/usePersistentWeapons';
import { useT } from './i18n';
import { getForceableSpells, getMonsterById, getRotationPresets, getStanceOptions, getWheel, revelationOptions, useMonsterData } from './lib/api';
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
  const [weaponPrefs, setWeaponPrefs] = usePersistentWeapons(inputs.vocation);
  const deferredWeapons = useDeferredValue(weaponPrefs);
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
  const request = useMemo(
    () =>
      points > 0
        ? {
            vocation: deferred.vocation,
            points,
            monster: null,
            monsters: deferredSpot,
            priority: deferred.priority,
            context: { mode },
            gems: deferredGems,
            character,
            meleeSkill: deferred.vocation === 'knight' ? (deferred.meleeSkill ?? undefined) : undefined,
            alternatives: 0,
            rotationId: rotationId ?? undefined,
            forcedSpells: forcedSpells.length ? forcedSpells : undefined,
            forcedStage2: forcedStage2.length ? forcedStage2 : undefined,
            forcedRevelations: forcedRevelations.length ? forcedRevelations : undefined,
            stances: stance === null ? undefined : stanceNames(stance),
            weapons: deferredWeapons.weapons.length ? deferredWeapons.weapons : undefined,
            suggestWeapons: deferredWeapons.weapons.length && deferredWeapons.suggest ? true : undefined,
          }
        : null,
    [deferred.vocation, points, deferredSpot, deferred.priority, mode, deferredGems, character, deferred.meleeSkill, rotationId, forcedSpells, forcedStage2, forcedRevelations, stance, deferredWeapons],
  );
  const optimized = useOptimizer(request);
  // The shown build may lag the inputs while the worker computes; everything below follows its own vocation.
  const resultVocation = optimized.input?.vocation ?? deferred.vocation;
  const current = resultVocation === inputs.vocation;
  const resultWheel = useMemo(() => getWheel(resultVocation), [resultVocation]);
  const shown: BuildResult | null = request ? optimized.result : null;
  const emptyVessels = useMemo(() => (shown && current ? emptyUnlockedByQuality(shown.vessels) : null), [shown, current]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:py-8">
      <header className="relative mb-4 pt-8 text-center sm:mb-6 sm:pt-0">
        <LanguageSwitch className="absolute top-0 right-0 w-20" />
        <h1 className="font-display text-2xl font-bold tracking-wide text-gold-300 sm:px-24 sm:text-3xl">{t('app.title')}</h1>
        <p className="mt-1 text-sm text-parchment-300">{t('app.subtitle')}</p>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <div className="flex flex-col gap-3">
          <VocationPicker value={inputs.vocation} onChange={(vocation) => update({ vocation })} />
          <CharacterPanel vocation={inputs.vocation} value={inputs} max={maxPoints} onChange={update} />
          <MonsterSearch value={spot} ready={monstersReady} onChange={(monsters) => update({ monsters })} />
          <FightContextPanel value={context} onChange={update} priority={inputs.priority} onPriorityChange={(priority) => update({ priority })} />
          <GemsPanel vocation={inputs.vocation} gems={gems} mods={wheel.mods} emptyVessels={emptyVessels} onChange={setGems} />
          <WeaponsPanel key={inputs.vocation} vocation={inputs.vocation} meleeSkill={inputs.meleeSkill} prefs={weaponPrefs} onChange={setWeaponPrefs} />
          <DebugCopy input={request} />
        </div>

        <div className="flex flex-col gap-3">
          <Panel title={t('app.wheelTitle', { vocation: VOCATION_LABELS[resultVocation] })} headingId="wheel-heading">
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
              usage={current ? shown?.rotation : undefined}
              stances={current ? shown?.stances : undefined}
            />
          </Panel>
          {current && shown?.weapon && (
            <Panel title={t('weaponResult.title')} headingId="weapon-result-heading">
              <WeaponResultPanel
                result={shown.weapon}
                owned={optimized.input?.weapons ?? []}
                suggest={weaponPrefs.suggest}
                busy={optimized.busy}
                onSuggestChange={(suggest) => setWeaponPrefs((p) => ({ ...p, suggest }))}
                onApplyPerks={(id, perks) => setWeaponPrefs((p) => ({ ...p, weapons: p.weapons.map((w) => (w.weaponId === id ? { ...w, perks } : w)) }))}
              />
            </Panel>
          )}
          <Panel title={t('app.summaryTitle')} headingId="results-heading">
            <div aria-live="polite" aria-busy={optimized.busy} className={optimized.busy ? "opacity-70 transition-opacity" : "transition-opacity"}>
              {shown ? (
                <ResultsPanel result={shown} />
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
                vocation={resultVocation}
                result={shown}
                mods={resultWheel.mods}
                onAddGem={current ? (rec) => setGems((all) => [...all, gemFromRecommendation(rec, all)]) : undefined}
                onUpgrade={current ? (u) => setGems((all) => setModGrade(all, u.kind, u.modId, u.toGrade)) : undefined}
              />
            </Panel>
          )}
        </div>
      </div>

      {shown && shown.rationale.length > 0 && (
        <Panel title={t('results.why')} headingId="why-heading" className="mt-3">
          <BuildRationale result={shown} />
        </Panel>
      )}

      <NotesPanel vocation={inputs.vocation} capacity={maxPoints} />

      <footer className="mt-6 text-center text-xs text-parchment-400">
        {t('app.footer')}{' '}
        <a href="./third-party-licenses.txt" className="underline hover:text-parchment-200">
          {t('app.licenses')}
        </a>
      </footer>
    </div>
  );
}
