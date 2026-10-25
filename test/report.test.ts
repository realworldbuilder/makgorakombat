import { describe, expect, it } from 'vitest';
import { issueBody, issueTitle, issueUrl, type Report } from '../src/game/report';

const report = (over: Partial<Report> = {}): Report => ({
  kind: 'bug',
  title: 'Charge goes through the wall',
  text: 'Cairne charged and came out behind the stage.',
  where: { screen: 'The fight', fighters: 'CAIRNE BLOODHOOF (WARRIOR) vs UNDEAD (ROGUE), player 2: cpu', stage: 'Ring of Valor, Orgrimmar', edition: 'World of Warcraft 12.1.5.70575 (wow)' },
  moment: { round: 2, phase: 'fight', secondsLeft: 41, health: [50, 100] },
  build: 'abc1234',
  page: 'https://realworldbuilder.github.io/makgorakombat/',
  browser: 'Chrome',
  window: '1600×900 at 2x',
  errors: [],
  ...over,
});

describe('report an issue', () => {
  it('titles a bug and an idea so the issue list tells them apart', () => {
    expect(issueTitle(report())).toBe('Bug: Charge goes through the wall');
    expect(issueTitle(report({ kind: 'idea', title: '  ', text: 'Add Arthas\nwith Frostmourne' }))).toBe('Idea: Add Arthas');
  });

  it('attaches where the player was', () => {
    const body = issueBody(report({ errors: ['error: TypeError: x is undefined'] }));
    expect(body).toContain('**What happened**');
    expect(body).toContain('- Fighters: CAIRNE BLOODHOOF (WARRIOR) vs UNDEAD (ROGUE), player 2: cpu');
    expect(body).toContain('- Round 2, fight, 41 s left, health 50 / 100');
    expect(body).toContain('- Build: abc1234');
    expect(body).toContain('error: TypeError: x is undefined');
  });

  it('fills in GitHub\'s new-issue page with the right label', () => {
    const url = new URL(issueUrl(report({ kind: 'idea' })));
    expect(url.origin + url.pathname).toBe('https://github.com/realworldbuilder/makgorakombat/issues/new');
    expect(url.searchParams.get('labels')).toBe('enhancement');
    expect(url.searchParams.get('title')).toBe('Idea: Charge goes through the wall');
    expect(url.searchParams.get('body')).toContain('**The idea**');
  });

  it('cuts a long report so the link still opens', () => {
    const url = issueUrl(report({ text: 'é'.repeat(2000), errors: Array.from({ length: 8 }, () => 'error: ' + 'y'.repeat(300)) }));
    expect(url.length).toBeLessThanOrEqual(7000);
    expect(new URL(url).searchParams.get('body')).toContain('cut short');
  });
});
