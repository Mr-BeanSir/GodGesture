# Template Moderation Override

This approved route-level exception extends the Web Console Master for the
template-review workspace only. All Master tokens, typography, accessibility,
theme, motion, and component rules remain mandatory.

## Working Surface

- At `1024px` and above, use one dense three-region working surface: a queue
  column, an immutable detail column, and a narrow action rail. The regions are
  separated by borders and spacing, not nested floating cards.
- The queue uses real buttons with `aria-selected`; detail selection does not
  alter immutable metadata or trigger an approval action.
- At narrower widths, stack queue, detail, action rail, and report list in that
  order while preserving every action and visible label.
- Keep package SHA-256 and target JSON inspectable in monospace, with local
  scrolling only inside those data regions. Never clip immutable metadata.
- Review and report mutations always open the shared confirmation dialog, show
  a translated success toast on completion, reload only the affected data, and
  retain an actionable error state on failure.
