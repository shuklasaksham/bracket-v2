# Bracket 2.0 — Figma parity plan

Goal: the shipped app matches the Figma file *Bracket 2.0 — Product Design*
(`e4xak6ZY9taIrU7toqbFvI`) screen for screen and state for state, with the
interactions from the prototype pages (08, 09) and the motion rules from
Foundations. The backend is extended so every v2 feature is real.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done (matches Figma, verified in mock)

## Motion rules (Foundations › Motion & accessibility)
- Fast 120ms ease-out: hover, press, toggles
- Base 200ms cubic-bezier(.2,.8,.2,1): panels, drawers, popovers
- 280ms: sheets and full-screen push
- Motion only for state change, hierarchy, open/close, navigation, processing, success
- prefers-reduced-motion: movement → 0ms opacity
- Skeletons appear after 300ms; never block layout with spinners
- Keyboard: ⌘K, ⌘J, J/K, X, ⌘↵, Esc closes panels and returns focus

## Responsive model
- ≥1280 sidebar (260 @1440, 232 @1280), docked panels 360–400
- 1024 icon rail (64), detail panels become overlay drawers
- 768 compact header + nav drawer, single column, slide-overs
- 390 tab bar, push navigation, bottom sheets, sticky 44px actions
- Sidebar toggle collapses to the rail (never disappears) on desktop

## Phases
1. [ ] Shell & motion system (rail collapse, transitions, page/panel/list motion, skeleton delay)
2. [ ] v2 data model + API contract (`docs/API_V2.md`), backend router `backend/v2.py`, mock parity
3. [ ] Overview + all states
4. [ ] Change review + states
5. [ ] Memory + states
6. [ ] Conversations + states
7. [ ] Ask Bracket + states
8. [ ] Timeline + states
9. [ ] Sources, Source detail, Files + states
10. [ ] Settings: Profile, Workspace, Members, Billing, Notifications, Privacy + dialogs
11. [ ] Global states: offline, session expired, trial ended, payment failed, expiring, archived, deletion scheduled, viewer, plan limit, 404
12. [ ] Auth: sign in/up, verify (wrong code, expired), forgot/reset/set password, Google hand-off, accept invite (+expired), onboarding 1–5
13. [ ] Marketing: landing, pricing, use cases, changelog, about, contact (+sent), legal ×3, 404, mobile menu
14. [ ] Mobile 390 pass over every screen above
15. [ ] Tablet 768 / laptop 1024 / 1280 pass
16. [ ] Emails (backend templates from page 11)
