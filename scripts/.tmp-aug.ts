import a from '../src/data/equipment/augments.json';
import { getDamageSpell, getHealingSpell } from '../src/data/damage';
const all = Object.entries((a as any).augments as Record<string, { spell: string; kind: string; value: number }[]>);
const miss = new Set<string>();
for (const [, l] of all) for (const x of l) if (!getDamageSpell(x.spell) && !getHealingSpell(x.spell)) miss.add(x.spell);
console.log('unknown spells:', [...miss].join(', '));
for (const [id, l] of all) console.log(id, l.map((x) => `${x.spell}:${x.kind}:${x.value}`).join(' ; '));
