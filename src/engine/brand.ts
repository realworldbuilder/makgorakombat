/** Every on-screen string of the fight in one place. */
export const BRAND = {
  title: "MAK'GORA KOMBAT",
  tagline: 'BLOOD. HONOR. FATALITY.',
  choose: 'CHOOSE YOUR CHAMPION',
  round: (n: number): string => `ROUND ${n}`,
  fight: 'FIGHT!',
  finish: "FINISH THE MAK'GORA!",
  fatality: 'DISHONOR!',
  flawless: 'HONOR RESTORED',
  ko: 'K.O.',
  roundWin: (p: string): string => `${p} WINS THE ROUND`,
  matchWin: (p: string): string => `${p} WINS THE MAK'GORA`,
  chosen: 'CHAMPION CHOSEN',
  summoning: 'SUMMONING…',
  enter: 'Enter World',
  ready: 'Ready',
  waiting: (p: string): string => `Waiting for ${p}`,
} as const;
