/*
 * Report an Issue, as the WoW Forever beta has it: a bug or a suggestion, written in the game and
 * sent with where the player was. It becomes a GitHub issue on the game's repository, which is
 * where both of us (and both Claudes) keep ideas and to-dos; the player's own browser opens the
 * new-issue page filled in, so nothing here needs a server or a token.
 */

export const REPO = 'https://github.com/realworldbuilder/makgorakombat';

export type ReportKind = 'bug' | 'idea';

/** What the game is showing, as Game.tsx says it; the report attaches it. */
export interface Where {
  screen: string;
  edition?: string;
  fighters?: string;
  stage?: string;
}

/** The fight's own moment, read from the live match when the report is opened in one. */
export interface Moment {
  round: number;
  phase: string;
  secondsLeft: number;
  health: [number, number];
}

export interface Report {
  kind: ReportKind;
  title: string;
  text: string;
  where: Where;
  moment?: Moment;
  build: string;
  page: string;
  browser: string;
  window: string;
  errors: readonly string[];
}

/** The game's text boxes take this much, as the beta's did. */
export const MAX_TEXT = 2000;
/** GitHub turns away a new-issue link much past 8 KB; the body is cut to stay under. */
const MAX_URL = 7000;
const KEEP_ERRORS = 8;

const KINDS: Record<ReportKind, { prefix: string; heading: string; label: string }> = {
  bug: { prefix: 'Bug', heading: 'What happened', label: 'bug' },
  idea: { prefix: 'Idea', heading: 'The idea', label: 'enhancement' },
};

/** The issue's text: what the player wrote, then everything the game attached. */
export function issueBody(report: Report): string {
  const { where, moment } = report;
  const lines = [`**${KINDS[report.kind].heading}**`, '', report.text.trim() || '_(nothing written)_', '', '**Where**', '', `- Screen: ${where.screen}`];
  if (where.fighters) lines.push(`- Fighters: ${where.fighters}`);
  if (where.stage) lines.push(`- Stage: ${where.stage}`);
  if (moment) lines.push(`- Round ${moment.round}, ${moment.phase}, ${moment.secondsLeft} s left, health ${moment.health[0]} / ${moment.health[1]}`);
  if (where.edition) lines.push(`- Game: ${where.edition}`);
  lines.push(`- Build: ${report.build}`, `- Page: ${report.page}`, `- Browser: ${report.browser}`, `- Window: ${report.window}`);
  if (report.errors.length > 0) lines.push('', '**Last errors in the console**', '', '```', ...report.errors, '```');
  lines.push('', '_Sent from the game\'s Report an Issue window (F6)._');
  return lines.join('\n');
}

export function issueTitle(report: Report): string {
  const title = report.title.trim() || report.text.trim().split('\n')[0]!.slice(0, 80) || 'No title';
  return `${KINDS[report.kind].prefix}: ${title}`;
}

/** GitHub's new-issue page with the report filled in; a long body is cut so the link still opens. */
export function issueUrl(report: Report): string {
  const link = (body: string) =>
    `${REPO}/issues/new?${new URLSearchParams({ title: issueTitle(report), body, labels: KINDS[report.kind].label }).toString()}`;
  let body = issueBody(report);
  let url = link(body);
  while (url.length > MAX_URL && body.length > 200) {
    body = `${body.slice(0, Math.floor(body.length * 0.8))}\n\n_(cut short to fit the link)_`;
    url = link(body);
  }
  return url;
}

/* ---- what the reporter reads from the rest of the game ------------------------------------- */

let where: Where = { screen: 'Title' };
let open = false;
const errors: string[] = [];

export const setWhere = (next: Where): void => {
  where = next;
};
export const currentWhere = (): Where => where;

/** Whether the window is open: the fight stands still while a report is being written. */
export const isReporting = (): boolean => open;
export const setReporting = (on: boolean): void => {
  open = on;
};

export const recentErrors = (): readonly string[] => errors;

/** Keep the last few errors and warnings for the report; they still go to the console as before. */
export function recordErrors(): void {
  const keep = (kind: string, parts: unknown[]) => {
    const text = parts.map((part) => (part instanceof Error ? `${part.name}: ${part.message}` : typeof part === 'string' ? part : safeJson(part))).join(' ');
    errors.push(`${kind}: ${text.slice(0, 300)}`);
    if (errors.length > KEEP_ERRORS) errors.shift();
  };
  for (const kind of ['error', 'warn'] as const) {
    const original = console[kind].bind(console);
    console[kind] = (...parts: unknown[]) => {
      keep(kind, parts);
      original(...parts);
    };
  }
  window.addEventListener('error', (event) => keep('error', [event.error ?? event.message]));
  window.addEventListener('unhandledrejection', (event) => keep('error', [event.reason]));
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
