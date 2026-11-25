import { useDeferredValue, useMemo, useState } from 'react';
import { useOptimizer } from './hooks/useOptimizer';
import { CharacterPanel } from './components/CharacterPanel';
import { EquipmentPanel } from './components/EquipmentPanel';
import { DebugCopy } from './components/DebugCopy';
import { ExportPanel } from './components/ExportPanel';
import { FightContextPanel } from './components/FightContextPanel';
import { GemsPanel } from './components/GemsPanel';
import { LanguageSwitch } from './components/LanguageSwitch';
import { MonsterSearch } from './components/MonsterSearch';
import { NotesPanel } from './components/NotesPanel';
import { Panel } from './components/Panel';
import { BuildRationale, ResultsPanel } from './components/ResultsPanel';
import { ComparePanel } from './components/ComparePanel';
import { parseOwnWheel } from './lib/compare';
import { SegmentedControl } from './components/SegmentedControl';
import { RotationPanel } from './components/RotationPanel';
import { VesselsPanel } from './components/VesselsPanel';
import { VocationPicker } from './components/VocationPicker';
import { WeaponResultPanel } from './components/WeaponResultPanel';
import { WheelChart } from './components/WheelChart';
import { usePersistentCompareCode, usePersistentGear, usePersistentGems, usePersistentWeapons } from './hooks/usePerVocationStorage';
import { gemFromRecommendation, setModGrade, updateGem } from './lib/gems';
import { usePersistentInputs } from './hooks/usePersistentInputs';
import { usePersistentSpellPrefs } from './hooks/usePersistentSpellPrefs';
import { useT } from './i18n';
import { CUSTOM_ROTATION_ID } from './types';
import { wheelVariants, getCustomRotationSpells, getExcludableSpells, getWeapon, getForceableSpells, getMonsterById, getRotationPresets, getStanceOptions, getTargetSpells, getWheel, revelationOptions, useMonsterData } from './lib/api';
import { stanceNames } from './lib/spellPrefs';
import type { BuildResult } from './lib/api';
import { characterOf, contextOf } from './lib/inputState';
import { gearInput } from './lib/gear';
import { resolveMonsters } from './lib/monsters';
import { emptyUnlockedByQuality } from './lib/vessels';
import { VOCATION_LABELS } from './lib/labels';
import { resetVocation } from './lib/inputStorage';
import type { Vocation } from './types';

/** D101: a reset remounts the optimizer, so every per-vocation hook reads its (now empty) storage again. */
export default function App() {
  const [epoch, setEpoch] = useState(0);
  return <Optimizer key={epoch} onReset={() => setEpoch((e) => e + 1)} />;
}

function Optimizer({ onReset }: { onReset: () => void }) {
  const t = useT();
  const [inputs, update] = usePersistentInputs();
  const [gems, setGems] = usePersistentGems(inputs.vocation);
  const [spellPrefs, updateSpellPrefs] = usePersistentSpellPrefs(inputs.vocation);
  const deferredPrefs = useDeferredValue(spellPrefs);
  const [weaponPrefs, setWeaponPrefs] = usePersistentWeapons(inputs.vocation);
  const deferredWeapons = useDeferredValue(weaponPrefs);
  const [gear, setGear] = usePersistentGear(inputs.vocation);
  const deferredGear = useDeferredValue(gear);
  const [compareCode, setCompareCode] = usePersistentCompareCode(inputs.vocation);
  const [showOwn, setShowOwn] = useState(false);
  const own = useMemo(() => parseOwnWheel(compareCode), [compareCode]);
  const compareWith = own && own.vocation === inputs.vocation && own.variant === inputs.wheel ? own.points : undefined;
  const deferredCompare = useDeferredValue(compareWith);
  const presets = useMemo(() => getRotationPresets(inputs.vocation), [inputs.vocation]);
  const forceable = useMemo(() => getForceableSpells(inputs.vocation), [inputs.vocation]);
  const customSpells = useMemo(() => getCustomRotationSpells(inputs.vocation), [inputs.vocation]);
  const excludable = useMemo(() => getExcludableSpells(inputs.vocation), [inputs.vocation]);
  const targetSpells = useMemo(() => getTargetSpells(inputs.vocation), [inputs.vocation]);
  // D107: clearing the spot restores the community averages.
  const [spotSize, setSpotSize] = useState(inputs.monsters.length);
  if (spotSize !== inputs.monsters.length) {
    setSpotSize(inputs.monsters.length);
    if (!inputs.monsters.length && Object.keys(spellPrefs.targets).length) updateSpellPrefs({ targets: {} });
  }
  const stanceOptions = useMemo(() => getStanceOptions(inputs.vocation), [inputs.vocation]);
  const monstersReady = useMonsterData();
  const deferred = useDeferredValue(inputs);
  const deferredGems = useDeferredValue(gems);

  const wheel = useMemo(() => getWheel(inputs.vocation, inputs.wheel), [inputs.vocation, inputs.wheel]);
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
  const { rotationId, forcedSpells, forcedStage2, forcedRevelations, stance, customRotation, excludedSpells, targets: spellTargets } = deferredPrefs;
  const revelationReach = useMemo(
    () => revelationOptions({ vocation: deferred.vocation, points, gems: deferredGems, character, wheelVariant: deferred.wheel }),
    [deferred.vocation, points, deferredGems, character, deferred.wheel],
  );
  const meleeSkill = deferred.vocation === 'knight' ? deferred.meleeSkill : null;
  const gearRequest = useMemo(() => gearInput(deferredGear), [deferredGear]);
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
            meleeSkill: meleeSkill ?? undefined,
            alternatives: 0,
            rotationId: rotationId ?? undefined,
            customRotation: rotationId === CUSTOM_ROTATION_ID && customRotation.length ? customRotation : undefined,
            forcedSpells: forcedSpells.length ? forcedSpells : undefined,
            forcedStage2: forcedStage2.length ? forcedStage2 : undefined,
            forcedRevelations: forcedRevelations.length ? forcedRevelations : undefined,
            excludedSpells: excludedSpells.length ? excludedSpells : undefined,
            spellTargets: mode === 'hunt' && Object.keys(spellTargets).length ? spellTargets : undefined,
            stances: stance === null ? undefined : stanceNames(stance),
            weapons: deferredWeapons.weapons.length ? deferredWeapons.weapons : undefined,
            suggestWeapons: deferredWeapons.weapons.length && deferredWeapons.suggest ? true : undefined,
            gear: gearRequest,
            charms: deferredGear.charms.length ? deferredGear.charms : undefined,
            wheelVariant: deferred.wheel === 'current' ? undefined : deferred.wheel,
            compareWith: deferredCompare,
          }
        : null,
    [deferredCompare, deferred.wheel, deferred.vocation, points, deferredSpot, deferred.priority, mode, deferredGems, character, meleeSkill, rotationId, customRotation, forcedSpells, forcedStage2, forcedRevelations, excludedSpells, spellTargets, stance, deferredWeapons, gearRequest, deferredGear.charms],
  );
  const optimized = useOptimizer(request);
  // The shown build may lag the inputs while the worker computes; everything below follows its own vocation.
  const resultVocation = optimized.input?.vocation ?? deferred.vocation;
  const resultVariant = optimized.input ? (optimized.input.wheelVariant ?? 'current') : deferred.wheel;
  const current = resultVocation === inputs.vocation && resultVariant === inputs.wheel;
  const resultWheel = useMemo(() => getWheel(resultVocation, resultVariant), [resultVocation, resultVariant]);
  const shown: BuildResult | null = request ? optimized.result : null;
  const weaponName = (current && shown?.weapon && getWeapon(shown.weapon.best.weaponId)?.name) || null;
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
          <EquipmentPanel
            key={inputs.vocation}
            vocation={inputs.vocation}
            meleeSkill={inputs.meleeSkill}
            gear={gear}
            onGear={setGear}
            worn={current ? shown?.gear : undefined}
            weaponName={weaponName}
            weapons={weaponPrefs}
            onWeapons={setWeaponPrefs}
            charmPicks={current ? shown?.charms : undefined}
          />
          <ResetButton vocation={inputs.vocation} onReset={onReset} />
          <DebugCopy input={request} />
        </div>

        <div className="flex flex-col gap-3">
          <Panel
            title={t('app.wheelTitle', { vocation: VOCATION_LABELS[resultVocation] })}
            headingId="wheel-heading"
            aside={
              wheelVariants().length > 1 && (
              <SegmentedControl
                size="sm"
                label={t('wheelVariant.label')}
                className="w-56 shrink-0"
                options={wheelVariants().map((v) => ({ value: v, label: t(`wheelVariant.${v}`), title: t(`wheelVariant.${v}Hint`) }))}
                value={inputs.wheel}
                onChange={(wheel) => update({ wheel })}
              />
              )
            }
          >
            {gems.length === 0 && (
              <p role="note" className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {t('app.noGems')}{' '}
                <a href="#gems-heading" className="font-medium text-gold-300 underline hover:text-gold-200">{t('app.noGemsLink')}</a>
              </p>
            )}
            {showOwn && current && shown?.comparison && (
              <p className="mb-2 text-center text-xs font-medium text-gold-300">{t('compare.ownWheel')}</p>
            )}
            <WheelChart
              wheel={resultWheel}
              variant={resultVariant}
              result={showOwn && current && shown?.comparison ? shown.comparison : shown}
              vessels={shown?.vessels}
              mods={resultWheel.mods}
            />
          </Panel>
          <Panel title={t('rotation.title')} headingId="rotation-heading">
            <RotationPanel
              presets={presets}
              customSpells={customSpells}
              spells={forceable}
              excludable={excludable}
              targetSpells={inputs.mode === 'hunt' ? targetSpells : []}
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
            <Panel title={t('compare.title')} headingId="compare-heading">
              <ComparePanel
                code={compareCode}
                onCode={(c) => setCompareCode(() => c)}
                own={own}
                vocation={inputs.vocation}
                variant={inputs.wheel}
                onVariant={(wheel) => update({ wheel })}
                comparison={current && compareWith ? shown.comparison : undefined}
                showOwn={showOwn}
                onShowOwn={setShowOwn}
              />
            </Panel>
          )}
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
                onSwap={
                  current
                    ? (s) =>
                        setGems((all) => {
                          const g = all.find((x) => x.id === s.gemId);
                          return g ? updateGem(all, { ...g, [s.slot]: { modId: s.to.modId, grade: s.to.grade } }) : all;
                        })
                    : undefined
                }
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

/** D101: clears every setting of the active vocation (other vocations keep theirs). */
function ResetButton({ vocation, onReset }: { vocation: Vocation; onReset: () => void }) {
  const t = useT();
  const reset = () => {
    if (!window.confirm(t('app.resetConfirm', { vocation: VOCATION_LABELS[vocation] }))) return;
    try {
      resetVocation(window.localStorage, vocation);
      // The URL mirrors the inputs; without this the old values would come back from it.
      const q = new URLSearchParams(window.location.search);
      const kept = new URLSearchParams([...q].filter(([k]) => k === 'v' || k === 'w' || k === 'o'));
      window.history.replaceState(window.history.state, '', `${window.location.pathname}?${kept.toString()}${window.location.hash}`);
    } catch {
      /* storage blocked — the remount still restores the defaults in memory */
    }
    onReset();
  };
  return (
    <div className="text-center">
      <button type="button" onClick={reset} className="text-xs text-parchment-400 underline hover:text-red-300">
        {t('app.reset', { vocation: VOCATION_LABELS[vocation] })}
      </button>
    </div>
  );
}
