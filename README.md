# Modular Web Translator Userscript

Modular Web Translator Userscript is a web page translator userscript for Tampermonkey and Violentmonkey. It translates supported websites inline, loads site modules remotely from GitHub, and lets users switch translation providers without reinstalling the main script.

If you want a Reddit translator userscript that can keep growing into a multi-site translator, this repository is built for that job.

## Install

- Install userscript: [modular-web-translator-userscript.user.js](https://raw.githubusercontent.com/Ilikeproton/Modular-Web-Translator-Userscript/main/modular-web-translator-userscript.user.js)
- Auto-update metadata: [modular-web-translator-userscript.meta.js](https://raw.githubusercontent.com/Ilikeproton/Modular-Web-Translator-Userscript/main/modular-web-translator-userscript.meta.js)

Works with:

- [Tampermonkey](https://www.tampermonkey.net/)
- [Violentmonkey](https://violentmonkey.github.io/)

## Why Users Install It

- One install for the core translator runtime
- Inline translation directly under page content
- Default `Auto Balance` mode that distributes requests across multiple providers
- Remote site modules let new website support ship faster
- Provider modules can expand without rewriting the core script
- Automatic provider rotation helps reduce `429` and other rate-limit failures
- Auto-update support through `@version`, `@updateURL`, and `@downloadURL`
- Designed for long-term multi-site expansion, not one hardcoded page

## Current Supported Reddit Pages

Current production support covers these Reddit page types:

- `https://www.reddit.com/`
- `https://www.reddit.com/new/`
- `https://www.reddit.com/r/popular/`
- `https://www.reddit.com/r/<subreddit>/`
- `https://www.reddit.com/r/<subreddit>/(hot|new|top|rising|controversial)`
- `https://www.reddit.com/r/<subreddit>/comments/<postId>/...`
- `https://www.reddit.com/comments/<postId>/...`
- `https://www.reddit.com/explore/*`

Current behavior:

- translate Reddit post titles inline
- translate Reddit post text bodies inline
- translate Reddit post-detail titles, bodies, and comment threads inline
- translate Reddit Explore community cards and descriptions
- react to dynamically loaded content
- let users switch provider and target language from the on-page settings panel

## Supported Translation Providers

Currently shipped and verified providers:

- `Auto Balance` as the default multi-provider strategy
- `Google Web` as an available provider
- `Google FR Web` as a Google Translate mirror provider
- `Google DE Web` as a Google Translate mirror provider
- `Bing Web` as an additional web translator provider
- `Lara Web` as an additional web translator provider
- `Youdao Web` as an additional web translator provider
- `Sogou Web` as an on-demand provider

Legacy provider files may still exist in the repository for research, but they are not shipped in [`providers/manifest.json`](./providers/manifest.json) unless they pass live verification again.

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

## How The Architecture Works

This repository uses three layers:

1. Core runtime
   - installed once by the user
   - auto-updated by the userscript manager
   - owns settings UI, cache, request helpers, provider loading, and module loading
2. Site modules
   - defined in [`modules/manifest.json`](./modules/manifest.json)
   - loaded remotely when the current page matches
   - let the project add support for more sites and more page types without forcing a core upgrade
3. Provider modules
   - defined in [`providers/manifest.json`](./providers/manifest.json)
   - `Auto Balance` uses multiple shipped providers together by default
   - users can still pin a specific provider if they want manual control

This means most day-to-day support expansion can happen through remote modules, while the main userscript only needs updates for runtime changes.

## Why This Repository Is Different

Most translator userscripts stop at one website page and become hard to extend. This repository is structured to support:

- more Reddit page types
- more websites over time
- more translation providers
- fewer forced reinstalls for users

The current Reddit support is the first implementation, not the final scope of the project.

## Current Module Layout

```text
.
|-- modules/
|   |-- manifest.json
|   |-- reddit-explore.module.js
|   |-- reddit-feed.module.js
|   |-- reddit-post-detail.module.js
|   `-- reddit-new.module.js
|-- providers/
|   |-- bing-web.provider.js
|   |-- google-de-web.provider.js
|   |-- google-fr-web.provider.js
|   |-- google-web.provider.js
|   |-- lara-web.provider.js
|   |-- manifest.json
|   |-- sogou-web.provider.js
|   `-- youdao-web.provider.js
|-- scripts/
|   `-- verify-providers.js
|-- modular-web-translator-userscript.meta.js
|-- modular-web-translator-userscript.user.js
|-- LICENSE
`-- README.md
```

## Files That Matter

- Main install file: [modular-web-translator-userscript.user.js](./modular-web-translator-userscript.user.js)
- Auto-update metadata: [modular-web-translator-userscript.meta.js](./modular-web-translator-userscript.meta.js)
- Site module registry: [modules/manifest.json](./modules/manifest.json)
- Reddit feed module: [modules/reddit-feed.module.js](./modules/reddit-feed.module.js)
- Reddit post-detail module: [modules/reddit-post-detail.module.js](./modules/reddit-post-detail.module.js)
- Reddit explore module: [modules/reddit-explore.module.js](./modules/reddit-explore.module.js)
- Provider registry: [providers/manifest.json](./providers/manifest.json)
- Google provider file: [providers/google-web.provider.js](./providers/google-web.provider.js)
- Google mirror provider: [providers/google-fr-web.provider.js](./providers/google-fr-web.provider.js)
- Google mirror provider: [providers/google-de-web.provider.js](./providers/google-de-web.provider.js)
- Additional provider: [providers/bing-web.provider.js](./providers/bing-web.provider.js)
- Additional provider: [providers/lara-web.provider.js](./providers/lara-web.provider.js)
- Additional provider: [providers/youdao-web.provider.js](./providers/youdao-web.provider.js)
- Optional provider: [providers/sogou-web.provider.js](./providers/sogou-web.provider.js)
- Smoke test script: [scripts/verify-providers.js](./scripts/verify-providers.js)

## Update Strategy

Core updates:

- checked by Tampermonkey or Violentmonkey
- delivered by `@updateURL` and `@downloadURL`
- used for runtime changes, compatibility fixes, and major upgrades

Site support updates:

- delivered by `modules/manifest.json` and remote module files
- used for new site support and new page-type support

Provider updates:

- delivered by `providers/manifest.json` and remote provider files
- used for new translator engines or provider fixes

## Verification

- Verify shipped providers: `node scripts/verify-providers.js`
- Verify every provider file in the repository, including legacy experiments: `node scripts/verify-providers.js --all`

## Privacy

- text selected for translation is sent to third-party translation endpoints
- current shipped endpoints include `translate.googleapis.com`, `translate.google.fr`, `translate.google.de`, `www.bing.com`, `app.laratranslate.com`, `webapi.laratranslate.com`, `fanyi.youdao.com`, and `fanyi.sogou.com`
- do not use this script on sensitive content unless you accept that risk

## Roadmap

- add more Reddit page coverage where it makes sense
- add support files for more websites
- add more translation provider modules
- keep the core runtime stable so normal support growth does not require constant upgrades

## Keywords

This repository targets these search intents:

- web page translator userscript
- website translator userscript
- Tampermonkey translator
- Violentmonkey translator
- Reddit translator userscript
- Reddit page translator
- multi-site translator userscript
- modular translator userscript
- inline webpage translation

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
