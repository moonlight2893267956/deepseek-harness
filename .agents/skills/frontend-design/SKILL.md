---
name: frontend-design
description: >-
  Use when the user asks to create, build, redesign, or beautify a web
  interface — landing pages, dashboards, marketing sites, web apps, UI
  components, or any HTML/CSS/JS front-end deliverable. Produces distinctive,
  production-grade visual designs that avoid generic AI aesthetics.
user-invocable: true
---

# Frontend Design

Use this skill whenever the request involves producing a visual front-end: a
website, landing page, dashboard, application shell, poster, or any
HTML/CSS/JS artifact. The goal is a distinctive, polished, and modern
interface — not a generic template.

## When to use

- The user asks to "build a page", "make a landing page", "design a dashboard",
  "create a UI", or similar.
- The deliverable is a web component, web page, or application the user will
  view in a browser.
- The task is about visual styling, layout, or front-end aesthetics.

Do not use this skill for backend-only work, data modeling, or non-visual CLI
tooling unless the deliverable is explicitly a rendered interface.

## Core principles

1. **Distinctive over generic.** Avoid the "AI look": centered hero, generic
   gradient blobs, default system font, three equal feature cards, and the same
   rounded rectangle everywhere. Choose a clear point of view for the visual
   system — typographic, brutalist, editorial, spatial, neobrutalist, etc.
2. **Typography is the design.** Pick a deliberate type scale, a real font
   pairing (e.g. a grotesk display with a humanist text face, or a serif
   headline with a mono accent), and use weight, size, and tracking as the
   primary hierarchy device.
3. **Color with intent.** Establish a small, coherent palette: one or two
   primaries, a near-black and near-white, and one accent used sparingly. Use
   color to signal state and focus, not to decorate.
4. **Layout as composition.** Use an intentional grid with asymmetry,
   intentional whitespace, and off-axis placement. Break the centered column
   when it serves the concept.
5. **Motion is functional.** Add transitions only where they aid comprehension
   (hover states, reveal-on-scroll, focus rings). Keep them quick and
   physically plausible. Respect `prefers-reduced-motion`.
6. **Real content, not lorem.** Use concrete, plausible copy. Name real
   sections, write real microcopy, and show realistic data in tables and charts.
7. **Production quality.** Semantic HTML, accessible contrast, keyboard
   focusability, responsive breakpoints, and no console errors. The result
   should run immediately.

## Working method

1. **Clarify the surface.** Decide whether the deliverable is a single HTML
   file, a component, or a multi-page app. Default to a single self-contained
   file when the user has not specified a framework, unless a framework is
   already established in the workspace.
2. **Pick the concept.** Commit to one visual direction before writing CSS.
   State it in one sentence (e.g. "editorial Swiss grid, mono labels, one red
   accent").
3. **Build the structure first.** Lay out the DOM and the grid before styling
   so the composition is sound.
4. **Style with the system.** Apply the type scale, palette, and spacing tokens
   consistently. Avoid one-off magic values.
5. **Polish interactions.** Add hover/focus/active states and restrained
   motion.
6. **Verify in a browser.** Open the result, check contrast and responsiveness,
   and fix issues before reporting done.

## Anti-patterns to reject

- Generic gradient hero with floating orbs.
- Every section as a centered card with a drop shadow.
- System default font with no hierarchy.
- Placeholder text ("Lorem ipsum") and empty charts.
- `em`/`rem` soup with no token system.
- Invisible focus states and sub-4.5:1 contrast.

## Quality bar

A finished design should look like it was made by a designer with a point of
view: coherent, confident, accessible, and immediately runnable in a browser.
