/** Official Wheel of Destiny planner export helpers (URL logic lives in the planner-code module). */

export { PLANNER_URL, plannerUrl } from '../data/wheel/plannerCode';

/** Copies text via the async Clipboard API, falling back to a hidden textarea + execCommand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied / insecure context — try the fallback */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  } catch {
    return false;
  }
}
