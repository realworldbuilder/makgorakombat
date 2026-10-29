/*
 * The class guides' carousel: the track scrolls and snaps by itself (a swipe on a phone); this adds
 * the arrows, the dots, the arrow keys and the slide number in the address, so a link can open on
 * any slide (#3). ?export lays every slide out at full size for the images that are posted.
 */

const track = document.querySelector<HTMLElement>('.track')!;
const slides = [...track.querySelectorAll<HTMLElement>('.slide')];
const prev = document.querySelector<HTMLButtonElement>('.prev')!;
const next = document.querySelector<HTMLButtonElement>('.next')!;
const dots = document.querySelector<HTMLOListElement>('.dots')!;

if (new URLSearchParams(location.search).has('export')) document.body.classList.add('export');

const buttons = slides.map((_, n) => {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `Slide ${n + 1}`;
  button.addEventListener('click', () => go(n));
  li.append(button);
  dots.append(li);
  return button;
});

let here = 0;

function go(n: number): void {
  const to = Math.max(0, Math.min(slides.length - 1, n));
  track.scrollTo({ left: to * track.clientWidth });
}

function show(n: number): void {
  here = n;
  buttons.forEach((button, i) => button.setAttribute('aria-current', String(i === n)));
  prev.disabled = n === 0;
  next.disabled = n === slides.length - 1;
  history.replaceState(null, '', n === 0 ? location.pathname + location.search : `#${n + 1}`);
}

prev.addEventListener('click', () => go(here - 1));
next.addEventListener('click', () => go(here + 1));

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') go(here - 1);
  else if (event.key === 'ArrowRight') go(here + 1);
  else return;
  event.preventDefault();
});

// The slide that fills most of the track is the one shown.
const seen = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) if (entry.isIntersecting) show(slides.indexOf(entry.target as HTMLElement));
  },
  { root: track, threshold: 0.6 },
);
for (const slide of slides) seen.observe(slide);

const start = Number(location.hash.slice(1)) - 1;
show(0);
if (start > 0) requestAnimationFrame(() => track.scrollTo({ left: Math.min(start, slides.length - 1) * track.clientWidth, behavior: 'instant' }));
