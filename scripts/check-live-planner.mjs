// Checks whether the official planner (www.tibia.com) already has the new wheel (Gem Vessels) that the
// export code targets. Exit 1 = it does: set WHEEL_UPDATE_RELEASED = true in src/data/wheel/release.ts (D90).
const PAGE = 'https://www.tibia.com/community/?subtopic=wheelofdestinyplanner';
const headers = { 'User-Agent': 'wheel-optimizer-research' };

const html = await (await fetch(PAGE, { headers })).text();
const lib = html.match(/https:\/\/static\.tibia\.com\/javascripts\/wheelofdestiny\/SkillwheelStringsJsonLibrary\.json[^"' ]*/)?.[0];
if (!lib) throw new Error('Planner string library not found on the official page');
const strings = await (await fetch(lib, { headers })).text();
if (strings.includes('Gem Vessel')) {
  console.log('Official planner has the new wheel: set WHEEL_UPDATE_RELEASED = true in src/data/wheel/release.ts (D90).');
  process.exit(1);
}
console.log('Official planner still has the old wheel (Vessel Resonance); keep the test-server link.');
