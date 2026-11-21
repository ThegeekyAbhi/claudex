/**
 * What a new page can start with. Each is ordinary Markdown placed under the page's heading, so a
 * starter is only a head start: the page is yours to change like any other.
 */
export const PAGE_STARTERS = ['blank', 'notes', 'checklist', 'plan'] as const;
export type PageStarter = (typeof PAGE_STARTERS)[number];

export const PAGE_STARTER_LABELS: Record<PageStarter, string> = {
  blank: 'Blank',
  notes: 'Notes',
  checklist: 'Checklist',
  plan: 'Plan',
};

const BODIES: Record<PageStarter, string | undefined> = {
  blank: undefined,
  notes: '## Notes\n\n- ',
  checklist: '- [ ] First thing to do',
  plan: '## Goal\n\n## Steps\n\n- [ ] First step\n\n## Open questions\n\n- ',
};

/** The Markdown under the heading, or undefined for a blank page. */
export function starterBody(starter: PageStarter | undefined): string | undefined {
  return starter ? BODIES[starter] : undefined;
}
