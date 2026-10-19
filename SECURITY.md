# Security policy

## Supported versions

Only the latest release of `RTXHDRGuard.plugin.js` is supported.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability** on this repository
(https://github.com/SenjuWoo/rtxhdr-guard/security/advisories/new). Please don't open a public
issue for anything that could be abused before it's fixed.

## Scope notes

This plugin runs inside Discord's renderer with the permissions BetterDiscord already has. It:

- makes no network requests;
- reads and writes no files;
- only calls Discord's own stores and the Flux dispatcher, plus `BdApi.Data` for its own settings.

It deliberately reaches into Discord internals that are not a public API. A report that a Discord
update broke a lookup is a bug, not a vulnerability — open an issue for that.
