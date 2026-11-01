# Third-party notices

Kiroku is licensed under the GNU Affero General Public License v3.0 (see [LICENSE](LICENSE)).
It is built on the following work, each under its own license.

## Editor engine

The document, spreadsheet, presentation and PDF editors come from
[ranuts/document](https://github.com/ranuts/document) (AGPL-3.0), which packages the
ONLYOFFICE editors to run fully in the browser. Kiroku uses it at a pinned commit with its own
changes in [engine.patch](engine.patch); [scripts/engine.sh](scripts/engine.sh) rebuilds it.

- **ONLYOFFICE editors** (sdkjs, web-apps) and the x2t converter: Copyright (C) Ascensio System SIA,
  AGPL-3.0 with additional terms under Section 7. Sources: https://github.com/ONLYOFFICE/sdkjs,
  https://github.com/ONLYOFFICE/web-apps. ONLYOFFICE GUI elements (illustrations, icon sets) are
  under CC BY-SA 4.0. Each editor's About pane and Kiroku's Settings > About show the original
  ONLYOFFICE logo (unmodified copies in `app/renderer/assets/onlyoffice/`). The full upstream
  notice, including how the logo term is handled, is in the engine's `NOTICE` file (after
  `scripts/engine.sh setup`, at `engine/NOTICE`).
- **ONLYOFFICE is a trademark of Ascensio System SIA.** Kiroku is not affiliated with or endorsed by
  Ascensio System SIA.
- **SheetJS** (bundled in the engine for legacy .xls): Apache-2.0.
- Fonts shipped with the engine keep their own licenses (see the engine's `NOTICE`).

## Desktop shell (`app/`)

- **Electron**: MIT.
- **pdf-lib**: MIT.
- **Fonts** in `app/renderer/assets/fonts/` (Comfortaa, Quicksand, Lexend Zetta, Michroma, Geist Mono):
  SIL Open Font License 1.1, texts alongside the fonts.

## Artwork

The photos, looping hero videos, icons and plastic UI pieces were generated for Kiroku with AI
image and video tools. They are distributed with Kiroku under the same terms as the rest of the repository.
