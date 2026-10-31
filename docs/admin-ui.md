# Administration UI

Updated: 31 October 2026.

## Scope and design

This is the existing signed-in workspace, Connections and account-settings UI. It does not introduce an administrator role or new permissions. Routes, ownership, forms, provider polling and the Laravel/Pi boundary remain intact. Task 4.1 remains the next numbered backend task.

Design tokens are scoped to `.admin-shell`: canvas `#F5F7FA`, surface `#FFFFFF`, ink `#202B3D`, secondary text `#637086`, border `#E1E6EE`, accent `#365BCC`. Dark mode uses slate surfaces and a lighter blue accent. Keep the existing Instrument Sans family: 24–30px page titles, 16–18px section titles, 14px body text. No new font or package downloads.

The layout is left aligned and task oriented:

```text
Workspace / account nav | Breadcrumb                 Open chat
                        | Page title + short explanation
                        | Main task / settings tabs
                        | Related controls, grouped by purpose
```

The design review removed the starter's empty metric cards and external framework links. The overview uses a short chat entry point and a directory of actual settings. The single blue accent identifies actions and the current location; borders separate real sections, with no decorative gradients or motion. Connections presents the default chat choice first, then a two-column provider grid that becomes one column on smaller screens. Technical local-server setup sits behind an explicit disclosure.

## Maintained components

- `AdminPage`: shared content width, page heading and introductory copy.
- `AppSidebar` / `NavMain`: Workspace and Account settings groups, active links, collapsed labels and mobile navigation.
- `SettingsLayout`: current section title and keyboard-accessible navigation between settings.
- Appearance: native radio choices with visual previews, immediately saved through the existing appearance hook.
- Existing form endpoints and provider-state components continue to own validation, sign-in, test, disconnect and save behavior.

## Verification

- `composer ci:check`: passed, including formatting (137 files), lint (97 files), TypeScript, 28 frontend tests, Pint (124 files), PHPStan (92 files), and 256 Laravel tests / 1416 assertions. Laravel tests use isolated in-memory SQLite databases. The first full-check attempt caught one formatting issue after the radio-group edit; that was corrected before the successful run.
- `php artisan agent:check`: passed signed connectivity and rejection of unsigned requests; no model run was started.
- Production build: passed on the final source in 122 seconds. The existing optional `fontaine` warning remains non-fatal. Built assets are ignored by Git.
- Calculated contrast of the new text/surface pairs: light secondary text on canvas 4.67:1, primary-button text 5.96:1, selected navigation 6.45:1; dark secondary text on card 7.33:1. These are token calculations, not a browser accessibility audit.
- Source review: existing routes and form submissions, provider polling, disconnect confirmation, password confirmation and ownership boundaries remain intact. No dependency, migration or engine change.
- Browser review could not be completed: no browser-control surface was available, and Computer Use stopped because it could not confidently determine the current browser URL. Desktop/mobile layouts, keyboard interaction, theme changes and connected/sign-in/error provider states still need visual acceptance. No screenshots or browser passes are claimed.

When the Compose stack is running, the local app is served at `http://localhost:8080/dashboard`. Existing MySQL and provider volumes were retained; no temporary account or test database was created for browser work. Implementation commit `a955d98` was pushed to both `main` and `development` on 31 October; both remote hashes were verified. The publication review preserved the validation evidence above from 28 October. Container tests were not repeated because Docker Desktop's Linux daemon was stopped; application source was unchanged during publication.

## Future optimization

Keep dashboard links static until a concrete need for live statistics exists; this avoids extra database and engine requests on entry. Any future administrator-only settings need server-side authorization, not just hidden navigation links.
