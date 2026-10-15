# The Closet Republic look

The forum looks like closetrepublic.com: dark only, black and white, with the soft prism when nature mode is on. All of it comes from the Closet Republic plugin in [`nodebb/plugin/`](../nodebb/plugin/), so it is installed and switched on by `install-forum.sh` with nothing to set by hand.

Screenshots from a test install are in [`docs/look-previews/`](look-previews/).

## What it adds

| Part | What members see |
|---|---|
| Dark skin "Closet Republic" | Black page, white text, grey panels, white pill buttons, the site's rounded font. It is the only skin: members cannot switch to a light one. |
| Header | The CR closet mark, "Closet Republic Forum", links to the main site, Constitution and Guidelines, and the **Nature** switch. |
| Nature mode (on by default) | The same soft, blended pastel prism as the main site: near the top and bottom of the screen and in a circle around the pointer. The header, footer and sidebar lines take the spectrum colours. |
| Nature mode off | Plain monochrome black and white, including category icons and avatars. |
| Switching | The Nature switch, a quick sideways swipe on a phone, or `?nature=true` / `?nature=false` added to any forum link. The choice is remembered in the `cr_nature` cookie, the same name the main site uses. |
| Footer | Main site links, legal links, the swipe hint and "Created by amaya@veronami" linking to amayakulkarni.com. |
| Icons | The colourful CR favicon on a white tile (browser tab, phone home screen) and the CR share image for links posted elsewhere. |
| Emails | Sign-up, welcome, password reset, notification, digest and other forum emails: black background, CR logo, a thin soft-spectrum stripe, white pill buttons and the same footer credit. |
| Code blocks | Dark panels with the high-contrast "a11y-dark" colours. |

## Accessibility

- The Nature switch is a real switch (`role="switch"`, `aria-checked`) that works with the keyboard, and each change is announced to screen readers.
- A hidden description, readable by screen readers, says what the screen looks like: the same prism and monochrome descriptions the main site uses.
- The prism layers are hidden from screen readers and never block clicks.
- With "reduce motion" set on the device, the prism stops drifting and the switch does not animate.
- Every focused control gets a thick white outline.
- If the browser or an extension forces its own colours (high contrast, Dark Reader and similar), the same alert as on the main site asks for it to be turned off.
- The admin panel keeps NodeBB's own look; none of this changes it.

## Applying it to a forum that is already installed

Copy the updated forum folder to the server and run the installer again with the same options as the first time, for example on the staging server:

```bash
sudo ./install-forum.sh --domain stage.closetrepublic.com --email amaya@veronami.com --db redis
```

The installer keeps the existing database, posts and passwords, updates the plugin, rebuilds NodeBB and restarts it. The look appears on the next page load.

## Changing the look later

Edit the files in `nodebb/plugin/`, then run the installer again (as above).

| To change | Edit |
|---|---|
| Colours, fonts, corners, buttons | `skin/variables.scss` (Bootstrap settings) |
| Prism softness and strength, header, footer layout, sidebar lines | `scss/closet-republic.scss` (the `--cr-prism-*` values at the top control the prism) |
| Header text and links | `templates/partials/header/brand.tpl` |
| Footer text and links, Nature switch behaviour, swipe | `public/closet-republic.js` |
| Logo, favicon, phone icons, email logo, share image | the files in `static/brand/` (same names) |
| Emails | `templates/emails/` (`partials/header.tpl` and `partials/footer.tpl` are shared by every email) |
| Main site address used in links | Add `CR_MAIN_SITE_URL=https://...` to `/etc/closet-republic/forum.env` (default `https://closetrepublic.com`), then run `sudo forum-pm2 startOrReload /opt/closet-republic/ecosystem.forum.config.cjs --update-env` |

The skin is saved again from `skin/variables.scss` every time the forum starts, so changes to it belong in that file, not in the admin panel's skin editor.

The favicon, icons, email logo, share image, site title and default skin are set once, the first time the plugin starts. Changes made afterwards in the admin panel (for example a new favicon) are kept. To set them again from the plugin's files, raise `BRAND_VERSION` in `nodebb/plugin/theme.js` by one and run the installer again.

## Notes

- The email templates are NodeBB 4.16.3's own templates with Closet Republic colours. After a future NodeBB upgrade, compare them with the new versions in NodeBB's `src/views/emails/`.
- Mail apps load the email logo from `https://<forum address>/closet-republic/email-logo.png`, which is allowed to be shown inside other sites' webmail.
