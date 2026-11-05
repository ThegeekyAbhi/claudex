# Claudex Marketplace presentation

Prepared against the official VS Code documentation on 2026-11-06. The destination is the **Visual Studio Marketplace**; GitHub hosts the source repository.

## Listing identity

- Display name: **Claudex**.
- Extension ID: `nerdyabhi.claudex` (`publisher.name`).
- Publisher: `nerdyabhi`, matching the publisher in the upload-error screenshot.
- Icon: `media/claudex-icon.png`, a 256 × 256 PNG with alpha transparency.
- Design source: `media/claudex-icon-master.png`, excluded from the VSIX.
- Header: `#111827` with the dark banner theme, complementing the blue mascot and orange scarf.
- Source and issue links use the existing Git remote, `ThegeekyAbhi/vcpm`. Confirm that repository and its issues are publicly accessible before launch.

Marketplace acceptance and name availability are verified by the service when publishing; local packaging does not reserve a name.

## What VS Code expects

The manifest's `icon` supplies the image for the Extensions list and Marketplace listing. VS Code specifies at least 128 × 128 pixels and recommends 256 × 256 for Retina screens. The listing icon cannot be SVG. The activity-bar and editor-tab SVGs are separate assets and may remain monochrome so they follow the editor theme.

The root README becomes the listing body. Keep the opening short: what Claudex does, why it helps, prerequisites, and how to start. The README now has a three-step walkthrough with screenshots of the current webview using sample conversations, not live provider results. Images live in `media/guide/` and are included in the VSIX. Detailed usage and limitations live in `docs/usage.md`. Keep screenshots free of personal paths and prompts.

README and changelog image URLs must resolve over HTTPS, and SVG content is restricted. Relative image links can be rewritten by vsce using the repository field, but the corresponding files must exist on the public branch. Upload source assets before relying on them in the listing. Avoid decorative badge collections and text inside the small icon.

The `galleryBanner` field controls the Marketplace page header color and theme. It is not a banner-image upload. Keywords and a clear description help discovery; repository, homepage, and issue links populate Resources.

## Build and upload

1. Run `pnpm check` with pnpm 10.33.2, then `pnpm package`.
2. Install `releases/claudex-0.7.0.vsix` with **Extensions: Install from VSIX…** to inspect the actual icon and display name locally. Disable the earlier local extension first.
3. In [publisher management](https://marketplace.visualstudio.com/manage), select **nerdyabhi → New extension → Visual Studio Code**, then upload the new VSIX. An older `agent-workspace` package still contains the old publisher and will reproduce the error.
4. Review the listing preview, name availability, source links, icon, and README before completing publication.

This preparation does not publish the extension or install the VSIX. No live provider smoke tests are required for icon preparation.

Changing from `local-workspace.agent-workspace` to `nerdyabhi.claudex` creates a separate VS Code identity and storage location. Do not delete the old extension's data or claim old sessions migrate automatically. Internal command IDs, settings keys, and native provider session IDs remain unchanged.

## Icon processing

Used the built-in image generation tool on the supplied mascot, then exported the listing size with macOS `sips`. The original attachment is untouched.

Prompt: Remove the surrounding black background with real alpha transparency; preserve the blue pixel-art mascot, navy outline, mint highlights, cream eye glints, orange scarf, and waving pose. Clean stray edge noise, center on a square canvas with clear padding, and keep it readable at small sizes. No redesign, text, badge, extra shapes, or external shadow.

## References

- [Extension manifest and presentation tips](https://code.visualstudio.com/api/references/extension-manifest)
- [Publishing extensions and Marketplace integration](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
