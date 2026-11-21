---
name: ledquill-ui-design
description: LedQuill's design system and UI rules. Use for EVERY frontend, UI, page, component, layout, styling, table, form, dashboard, empty state, or visual polish task in the frontend/ folder, even small ones like adding a button or a column. It overrides generic design taste; use it together with the frontend-design skill, with this skill winning on conflicts.
---

# LedQuill UI Design

## Product and users

LedQuill is a back-office tool for accounts staff and finance reviewers who check
invoices all day. They value accuracy, speed and calm over decoration. The UI
should feel like a well-made accounting instrument: quiet surfaces, sharp type,
numbers that line up, and problems that are impossible to miss.

Design question for every screen: *what must the reviewer notice first, and what
must they do next?* Put that first; everything else recedes.

## Design tokens (single source: `frontend/app/globals.css` CSS variables)

Typography
- UI: **IBM Plex Sans** (400, 500, 600). Numbers and IDs: **IBM Plex Mono** or
  Plex Sans with `font-variant-numeric: tabular-nums`. Load with `next/font`.
- Scale (px): 12 caption, 13 table/body-small, 14 body, 16 section, 20 page
  title, 24 dashboard figure. No text above 24 except one KPI figure.
- Weight carries hierarchy, not size: 600 for titles and labels that matter.

Colour (light; dark mode mirrors with the same roles)
- `--ink` #16202E (text), `--ink-muted` #5B6676, `--line` #E3E6EA,
  `--surface` #FFFFFF, `--canvas` #F6F7F9.
- `--accent` #1F4E79 (ledger blue) for primary actions and focus. One accent only.
- Status (meaning only, never decoration): ready #1E7A4F, needs review #B26A00,
  failed #B42318, approved #1F4E79, processing #5B6676.
- Status tints for backgrounds at ~10% opacity of the same hue.

Shape and space
- Radius 6px (inputs, buttons), 8px (panels). No pill buttons, no 16px+ radii.
- Spacing scale 4/8/12/16/24/32. Tables use 8/12 cell padding.
- Borders (1px `--line`) separate; shadows only on overlays (menus, dialogs).

## Layout

- App shell: left sidebar (Upload, Documents, Review queue, Search, Dashboard),
  top bar with page title and global search. Sidebar collapses to icons < 1024px
  and to a drawer < 768px.
- Content max width 1280px; tables can use full width.
- **Invoice detail** is the core screen: issues banner on top (if any), then a
  split view — source on the left (page image or extracted text with page
  switcher), fields form on the right, line items table below the form.
  On mobile the split becomes tabs: Fields / Source / Issues.

## Patterns that make it feel professional

- **Numbers:** right-aligned, tabular, thousands separators, 2 decimals,
  currency code beside the column header, not on every cell.
- **Missing values:** show `—` with tooltip "Not found in document". Never 0.
- **Confidence:** >= 0.9 no marker; 0.7-0.9 small amber dot; < 0.7 amber field
  background + "Low confidence" text. Never show raw 0.73 to the user except in
  a tooltip.
- **Validation issues:** say what is wrong with the numbers, e.g.
  "Total mismatch: subtotal 1,000.00 + tax 150.00 = 1,150.00, printed 1,200.00".
  Link each issue to the field it concerns; clicking focuses that field.
- **Status chips:** small, text + colour (never colour alone), sentence case.
- **Edits:** inline, field turns editable on click, Save / Cancel, shows
  "Edited" marker afterwards; validation re-runs and issues update in place.
- **Progress:** per-file progress row with stage name ("OCR page 12 of 40"),
  not a spinner alone.
- **Tables:** sticky header, sortable key columns, row hover, keyboard row
  navigation, filters above the table, pagination with total count.

## States (every data view needs all four)

- Loading: skeleton matching the final layout, not a centered spinner.
- Empty: one line explaining why + the next action ("No invoices need review").
- Error: what failed in plain words + retry. Never a raw stack trace.
- Partial: show what loaded; mark what did not.

## Copy

Plain, specific, sentence case. Verbs on buttons ("Upload files", "Approve
invoice", "Reprocess"). No exclamation marks, no emoji, no marketing words
("magic", "seamless", "AI-powered"). Errors say what happened and what to do.

## Anti-AI-vibe checklist (reject the design if any is true)

- [ ] Gradient backgrounds or gradient text used for decoration
- [ ] Glassmorphism, glow, neon, or heavy drop shadows on cards
- [ ] A grid of identical rounded cards where a table would serve better
- [ ] Hero-style huge headings inside an app screen
- [ ] Purple/blue default palette not from the tokens above
- [ ] Emoji or sparkle icons as UI decoration
- [ ] Placeholder text, lorem ipsum, or invented metrics
- [ ] Every page using the same layout regardless of its job
- [ ] Animation that does not explain a change of state (keep < 200ms, respect
      `prefers-reduced-motion`)

## Accessibility and responsiveness

- WCAG AA contrast; visible focus ring (2px `--accent`); full keyboard use.
- Semantic HTML (table for tabular data, labels on every input, buttons for
  actions, links for navigation); ARIA only where HTML cannot express it.
- Check at 375, 768, 1280 and 1536px; no horizontal page scroll — wide tables
  scroll inside their own container.
- Light and dark mode both checked before reporting done.

## shadcn/ui usage

Use shadcn components as the base, restyled through the tokens above. Do not
add a second component library. Icons: lucide-react only, 16px in tables,
20px in navigation.
