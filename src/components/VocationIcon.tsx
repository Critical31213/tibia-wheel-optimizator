import type { Vocation } from '../types';

const PATHS: Record<Vocation, string[]> = {
  // Sword
  knight: ['M14.5 3.5H20.5V9.5L9.5 20.5', 'M14.5 3.5L3.5 14.5', 'M5 12l7 7', 'M3.5 20.5l3-3'],
  // Bow and arrow
  paladin: ['M7 3c7 3 7 15 0 18', 'M7 3v18', 'M3 12h17', 'M17 9l3 3-3 3'],
  // Lightning bolt
  sorcerer: ['M13 2.5L5 13.5h6.5l-1 8 8-11H12z'],
  // Leaf
  druid: ['M5 19C5 10 10.5 4.5 20 4c-.5 9.5-6 15-15 15z', 'M5 19l9-9'],
  // Balance / yin-yang-like circle
  monk: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 3a4.5 4.5 0 0 1 0 9a4.5 4.5 0 0 0 0 9'],
};

/** Simple stroke icon per vocation (inherits `currentColor`). */
export function VocationIcon({ vocation, className }: { vocation: Vocation; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[vocation].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
