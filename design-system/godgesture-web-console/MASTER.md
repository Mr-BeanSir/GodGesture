# GodGesture Web Console Design System

## Scope

This is the source of truth for the Server-owned Web Console. It is an
operational console for account, configuration, device, snapshot, security,
template moderation, and administrator work. It is not a marketing site. Read
this file before adding or changing a Web Console route. Add a page override
only for an approved, documented exception.

## Direction

- Quiet, professional, high-density operations UI.
- Light theme is the default; dark theme is a complete first-class theme.
- Use hierarchy, spacing, typography, borders, and restrained status color.
  Do not use a hero, bento marketing layout, decorative gradients, oversized
  display type, floating section cards, or decorative animation.
- Keep one clear primary action per tool surface. Destructive actions stay
  visually and spatially separate.

## Tokens

Use Tailwind semantic utilities backed by CSS variables. Components must not
introduce raw per-screen colors.

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#f8fafc` | `#0f172a` |
| Surface | `#ffffff` | `#111c2e` |
| Surface muted | `#f1f5f9` | `#172338` |
| Text | `#0f172a` | `#f8fafc` |
| Text muted | `#64748b` | `#94a3b8` |
| Border | `#dbe3ee` | `#314158` |
| Primary | `#0369a1` | `#38bdf8` |
| On primary | `#ffffff` | `#082f49` |
| Success | `#15803d` | `#4ade80` |
| Warning | `#b45309` | `#fbbf24` |
| Danger | `#b91c1c` | `#f87171` |
| On danger | `#ffffff` | `#450a0a` |
| Overlay subtle | `rgb(15 23 42 / 0.35)` | `rgb(2 6 23 / 0.56)` |
| Overlay | `rgb(15 23 42 / 0.5)` | `rgb(2 6 23 / 0.72)` |

Use 4px as the base spatial unit. Default data-table rows are 40px; compact
controls are 36px; icon-only controls retain a 40px hit area. Any mobile
fallback must preserve a 44px touch target.

## Typography And Icons

- UI text: `Aptos`, `Segoe UI Variable`, `PingFang SC`, sans-serif.
- Data and hashes: `Cascadia Mono`, `SFMono-Regular`, monospace, with tabular
  numerals.
- Use a 12/13/14/16/20/24px type scale; avoid negative letter spacing.
- Use Lucide outline icons at the semantic action level, with text labels for
  navigation and unfamiliar actions. Icon-only controls require an accessible
  name and tooltip.
- Gesture and boundary mnemonics must continue to use
  `packages/shared/src/assets/mnemonic.svg` through the existing component
  path. Do not duplicate, redraw, or replace that asset.

## Layout

- Full workspace navigation begins at 1024px: a stable 248px sidebar, a 56px
  header, and a scrollable main region. At narrower widths, use a labelled
  compact navigation control and preserve route access.
- Keep a predictable page header, then a single working surface such as a
  table, detail inspector, or form. Do not nest cards within cards.
- Tables use a sticky header where useful, horizontal overflow only inside the
  table wrapper, row hover, and visible keyboard focus. Preserve complete data
  with wrapping, tooltip, or detail view rather than silent clipping.
- Use a defined layer scale: base 0, sticky navigation 20, dropdown 40,
  dialog 60, toast 80.

## Components And States

- Build project-local Vue components for buttons, badges, alerts, panels,
  dialogs, toasts, empty states, loaders, inputs, selects, tables, and
  pagination. Prefer semantic native controls.
- Visible labels, errors adjacent to their fields, disabled semantics, loading
  feedback, error recovery, confirmation before destructive work, and
  `aria-live` notifications are required.
- Dialogs support Escape, a labelled close control, focus placement, focus
  restoration, and a real modal backdrop. All route changes move focus to the
  main heading.
- Use only 150-200ms opacity/transform transitions. Respect
  `prefers-reduced-motion`; do not use scroll reveals or decorative continuous
  animation.

## Route Design Workflow

Before implementing or materially redesigning a route, read this Master and its
existing page override, if any, then use `ui-ux-pro-max` with the corresponding
Vue stack query. A missing page override is expected and is not an error.

| Route | Required Vue stack query |
| --- | --- |
| Login/register/reset | `authentication form registration password reset quiet high-density operations console` |
| OAuth callback | `oauth callback pending email binding error recovery operations console` |
| Overview | `account synchronization overview compact operations dashboard` |
| Config | `read only configuration inspector semantic data table dense operations console` |
| Devices | `device inventory rename destructive confirmation accessible operations console` |
| Snapshots | `version history pagination restore conflict confirmation dense operations console` |
| Security | `account security session logout oauth identity metadata operations console` |
| Administrator | `administrator user table quota form destructive action operations console` |
| Template moderation | `template moderation immutable detail review queue report resolution operations console` |

Apply skill results only when they remain compatible with this Master and the
confirmed product constraints. This Master is the durable default and must not
be regenerated with `--force`. Create or update a file under `pages/` only for
an approved route-specific exception; a new route does not require an override
file by default.

## Accessibility And Validation

- Meet WCAG AA: primary text contrast >= 4.5:1, visible 2-4px focus ring,
  logical tab order, semantic headings, skip link, and no color-only status.
- Verify light and dark themes independently at 375px, 768px, 1024px, and
  1440px. The primary operational desktop target is >=1024px.
- Every data state needs loading, empty, error, and retry or recovery behavior
  where the API permits it.
