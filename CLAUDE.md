# CLAUDE.md

## Frontend UI work

- Before building or changing any screen in `frontend/`, read `DESIGN.md` at the
  repo root. Its tokens and rules win over any skill's defaults.
- Project skills in `.claude/skills/`:
  - `redesign-existing-projects`: improving an existing screen (most UI work here).
  - `design-taste-frontend`: new standalone pages (login, guest invite, landing).
    It targets marketing pages, so for dashboards and forms keep to `DESIGN.md`.
  - `web-design-guidelines`: run on changed `.tsx`/`.css` files before committing.
- Check `cd frontend && npx tsc --noEmit && npx next build` passes before pushing.
