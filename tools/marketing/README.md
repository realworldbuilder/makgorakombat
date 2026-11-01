# Marketing cards on the ability wall

Every card is one page, `index.html?f=<card>`, drawn at the network's own pixel size on the shared
ability wall (`shared/ability-wall.ts` and `.css`, the combos guide's cover). It is not part of the
site: run `pnpm dev` and open `http://localhost:5173/makgorakombat/tools/marketing/?f=og`.

| `?f=`  | Size        | For                                                                      |
| ------ | ----------- | ------------------------------------------------------------------------ |
| `og`   | 1200 x 630  | the social card a link unfurls to                                        |
| `x`    | 1500 x 500  | the X header; the avatar covers its lower left, so the pitch sits right   |
| `yt`   | 2560 x 1440 | the YouTube banner; only the middle 1546 x 423 shows on every screen      |
| `reel` | 1080 x 1920 | a 9:16 background that drifts up the tilt; `&still` stops it              |

Add `&bare` to any card for the wall and shade alone, without the logo and words.

A headless browser at the card's size takes the finished image. The site's social card is
`public/og.jpg`; the X header and YouTube banner are in `public/brand/`, also served from the site. The drift loops after one period of
the wall, `--wall-period` (90 s on the reel), so a clip of exactly that length loops with no seam.
Step it by hand for a smooth video: pause the grid's animation and set `animation-delay` to minus
the frame's time before each screenshot.

No Blizzard logos, ever: the mark is our own Mak'gora logo (`/welcome/logo.webp`) and text.
