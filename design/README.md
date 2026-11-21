# Omnix design handoff

The approved redesign, as files Claude Code can read and match exactly.

## What's here

| Path | What it is |
| --- | --- |
| `reference/*.html` | All 20 approved screens as plain HTML + CSS. **This is the source of truth.** Open any file in a browser. Press `d` to toggle dark mode (or add `#dark` to the URL). Narrow the window below 768px to see mobile. |
| `globals.css` | Tailwind v4 / shadcn theme tokens. Replaces the `:root` / `.dark` blocks in `app/globals.css`. |
| `assets/avatars/blob-*.svg` | The four blob-monster avatars (stand-ins; swap for your production art if you have it). |
| `assets/mascot.svg` | Planet-ghost mascot, for empty and success states only. |
| `assets/logo-mark.svg` | Placeholder logo mark. |

Figma library (same tokens and components): https://www.figma.com/design/7MUNuziYcvflO1lTq15uPo

## Rules for implementing (Claude Code: follow these)

1. **Match the reference HTML exactly**: spacing, sizes, radii, colors, copy, order of elements. Read the matching `reference/NN-*.html` file before building each screen. When in doubt, the reference wins over your own taste.
2. **Translate, don't copy.** Rebuild the markup as React components with Tailwind classes and the theme tokens from `globals.css`. Do not paste the reference CSS into the app. Class map:
   - `.btn.bp` → `<Button>` default (ink); `.bs` → `variant="outline"`; `.bb` → brand indigo; `.bd` → destructive outline
   - `.card` / `.acard` → `rounded-2xl border bg-card shadow-sm`
   - `.toggle` → shadcn `<Switch>`; `.seg` → `<Tabs>` list; `.drawer.glass` → `<Sheet>` with the `glass` utility
   - `.h0` / `.h1` → `font-display`; `.mono` / `.idchip` → `font-mono`
   - CSS vars in the reference (`--fg2`, `--brand-text` …) map to tokens: `--fg2` → `text-muted-foreground`, `--brand-text` → `text-brand-text`, `--accent` → `bg-accent`, `--border2` → `border-input`, `--run` → `bg-run-panel`.
3. **Keep existing behavior.** Agent CRUD, chat streaming, connections and the tool-permission model already work. Restyle and restructure around them; don't rewrite data logic. Write tools (`gmail.create_draft`, `gmail.send`) stay off by default.
4. **Reuse components.** Build each shared piece once (Sidebar, AgentAvatar, AgentCard, ToolPermissionRow, IntegrationTile, RunStepRow, UsageMeter, ModelChip, SuggestionChip) and use it everywhere it appears.
5. **Responsive + dark mode are required**, not extras: check every screen at 1440 and 390, light and dark.
6. **Verify visually** after each screen: screenshot the running app next to the reference file at the same width and fix differences before moving on.

## Build order

1. Tokens + fonts (Figtree, Bricolage Grotesque, JetBrains Mono via `next/font`) + `next-themes`
2. App shell: sidebar (256px) + mobile top bar; move Next dev indicator: `devIndicators: { position: 'bottom-right' }`
3. Shared components (rule 4)
4. Screens: Home → Agent chat + 4 drawer tabs → Create agent → Success → Agents + empty → Live run → Inbox → Integrations → Marketplace → Usage & billing → Settings → Profile menu → Landing → Auth
