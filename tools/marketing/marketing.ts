/*
 * Picks the card from ?f= before the wall is filled, so the wall knows its size: og (the social card,
 * 1200 x 630), x (the X header, 1500 x 500), yt (the YouTube banner, 2560 x 1440) or reel (a 1080 x
 * 1920 drifting background). ?still stops a drifting card for a screenshot, and ?bare leaves the words
 * off, the wall alone to put under a reel's own.
 */

const params = new URLSearchParams(location.search);
const format = params.get('f') ?? 'og';
document.documentElement.dataset.f = format;
if (params.has('bare')) document.querySelector('.pitch')?.remove();
if (format === 'reel' && !params.has('still')) document.querySelector('.ability-wall')?.classList.add('drift');

// The wall fills itself on import, so it is imported only once the card is set.
void import('../../shared/ability-wall');
