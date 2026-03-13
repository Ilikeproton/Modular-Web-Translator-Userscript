# Modular Web Translator Userscript

Translate websites inline with one installable userscript for Tampermonkey and Violentmonkey. Modular Web Translator Userscript is a modular web page translator that loads site-specific modules and translation provider modules from GitHub, so new website support and new translator engines can be added without forcing users to reinstall the main script.

Current live support: `www.reddit.com/new`. The core script is built for multi-site expansion, automatic userscript updates, remote module loading, and fast rollout of new supported websites.

## Install Now

- Install userscript: [modular-web-translator-userscript.user.js](https://raw.githubusercontent.com/Ilikeproton/Modular-Web-Translator-Userscript/main/modular-web-translator-userscript.user.js)
- Metadata for auto-update: [modular-web-translator-userscript.meta.js](https://raw.githubusercontent.com/Ilikeproton/Modular-Web-Translator-Userscript/main/modular-web-translator-userscript.meta.js)

Works with:

- [Tampermonkey](https://www.tampermonkey.net/)
- [Violentmonkey](https://violentmonkey.github.io/)

## Why Use This Userscript

- One installation for the core translator runtime
- Remote site modules allow new website support without reinstalling the main userscript
- Remote provider modules allow new translation engines without rewriting the core runtime
- Built-in auto-update through `@version`, `@updateURL`, and `@downloadURL`
- Inline translation directly under original page content
- Supports free web translation providers
- Designed for expandable multi-site support instead of one hardcoded page forever

## Current Supported Site

The current production module supports:

- `https://www.reddit.com/new`
- `https://www.reddit.com/new/`
- `https://www.reddit.com/new/*`

Current site behavior:

- detect Reddit post titles and text bodies
- translate content inline under the original text
- allow translation provider switching
- allow target language switching
- observe dynamically loaded content

## Supported Translation Providers

- `Google Web`
- `Sogou Web`

## Supported Target Languages

- Simplified Chinese
- English
- Japanese
- Korean
- French
- German
- Spanish
- Russian
- Vietnamese
- Thai

## How It Works

This repository uses a two-layer update model:

1. Core loader:
   - installed once by the user
   - updated automatically by the userscript manager
   - provides shared translation runtime, settings UI, provider logic, cache, and remote module loader
2. Site modules:
   - defined in [`modules/manifest.json`](./modules/manifest.json)
   - downloaded remotely from GitHub when the current page matches
   - can add support for new websites without changing the main script file
3. Translation provider modules:
   - defined in [`providers/manifest.json`](./providers/manifest.json)
   - default provider is `Google Web`
   - additional providers are loaded on demand when the user switches provider
   - future translator engines can be added without moving provider logic back into the main script

This means normal website support growth happens through remote modules, while major runtime changes happen through a new core version.

## Why This Is Better For Users

Most userscripts only support one site or one page and require a reinstall when the author expands functionality. This project is built differently:

- users install once
- the core script can auto-update
- site support can expand independently
- new supported websites can be shipped faster

For users, that means less maintenance and faster access to new supported pages.

## Why This Is Better For Expansion

Most translation scripts become hard to maintain because site-specific DOM logic is mixed into one large file. This repository keeps the main translator runtime reusable and moves website support into separate JavaScript modules.

That makes it easier to:

- add new websites
- add new page types on the same website
- keep fixes isolated to one site module
- avoid unnecessary core upgrades

## Repository Structure

```text
.
├─ modules/
│  ├─ manifest.json
│  └─ reddit-new.module.js
├─ providers/
│  ├─ google-web.provider.js
│  ├─ manifest.json
│  └─ sogou-web.provider.js
├─ modular-web-translator-userscript.meta.js
├─ modular-web-translator-userscript.user.js
├─ LICENSE
└─ README.md
```

## Files That Matter

- Main install file: [modular-web-translator-userscript.user.js](./modular-web-translator-userscript.user.js)
- Auto-update metadata: [modular-web-translator-userscript.meta.js](./modular-web-translator-userscript.meta.js)
- Remote module registry: [modules/manifest.json](./modules/manifest.json)
- Current Reddit module: [modules/reddit-new.module.js](./modules/reddit-new.module.js)
- Provider registry: [providers/manifest.json](./providers/manifest.json)
- Default Google provider: [providers/google-web.provider.js](./providers/google-web.provider.js)
- On-demand Sogou provider: [providers/sogou-web.provider.js](./providers/sogou-web.provider.js)

## Automatic Update Strategy

Core script updates:

- handled by Tampermonkey or Violentmonkey
- compare local and remote `@version`
- use `@updateURL` to check updates
- use `@downloadURL` to download the new core script

Site support updates:

- handled by the remote manifest and remote module files
- no reinstall needed for normal site-support expansion
- only the matching site module is fetched and executed

Provider updates:

- handled by the remote provider manifest and provider module files
- `Google Web` is preloaded as the default provider
- other providers load when the user selects them
- future providers can be added without hardcoding them into the main script

## Privacy Notes

- Page text is sent to third-party translation endpoints when translation is requested
- Current endpoints used by the runtime:
  - `translate.googleapis.com`
  - `fanyi.sogou.com`
- Do not use this script for sensitive or private content unless you accept that risk

## Roadmap

- add more supported websites
- add more supported page patterns per website
- keep the runtime stable and reusable
- minimize core upgrades unless shared behavior changes

## SEO Keywords

This repository is intentionally aligned with these search intents:

- web page translator userscript
- website translator userscript
- Tampermonkey translator
- Violentmonkey translator
- modular web translator
- multi-site translator userscript
- Reddit translator userscript
- inline webpage translation

## GitHub Ready Notes

- `.prompt/` is kept out of commits through `.gitignore`
- the repository includes an open-source license
- the install file name now matches the repository naming direction
- raw GitHub URLs are used for userscript auto-update and remote module delivery

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
