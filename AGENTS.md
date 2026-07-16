# Repository Guidelines

## Project Structure & Module Organization

WahtWay has three Node.js applications. `client/src/` contains the React 19 and Vite UI; `client/electron/` contains the Electron processes. The embedded Express API lives in `client/be/src/`, with routes, skills, and tools grouped into matching subdirectories. `server/src/` powers the standalone Skill Hub, while `server/public/` is its static UI. Skill definitions are JSON files under each application's `data/skills/`. Treat `client/data/logs/`, conversation JSON, `dist/`, and `release/` as generated output. Security notes live in `docs/`.

## Build, Test, and Development Commands

Install dependencies separately with `npm ci` in `client/`, `client/be/`, and `server/`.

- `cd client/be && npm run dev`: start the embedded API on port 3000. Supply `DEEPSEEK_API_KEY` in the environment.
- `cd client && npm run dev`: start Vite on port 5173 and proxy `/api` to port 3000.
- `cd client && npm run build`: build the Vite UI and bundle the embedded backend.
- `cd client && npm run electron`: launch the built desktop application.
- `cd server && npm run dev`: run the Skill Hub on port 4000.
- `cd server && npm run build`: type-check and compile the Hub to `dist/`.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, double quotes, and semicolons, matching existing files. Name React components and interfaces in `PascalCase`, functions and variables in `camelCase`, and Skill IDs/files in kebab case (for example, `daily-study-plan.json`). Keep route handlers thin and place reusable domain logic in `skills/` or `tools/`. No formatter or linter is configured; keep diffs consistent with neighboring code and run the relevant build before submitting.

## Testing Guidelines

There is currently no automated test framework or coverage threshold. For every change, run `npm run build` in `client/` and `server/`, then smoke-test affected endpoints such as `/api/health`. UI changes require a manual browser or Electron check; include screenshots for visible changes. Add future tests beside the implementation as `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, and `chore:`. Keep commits focused and use an imperative summary. Pull requests should explain behavior and risk, list validation performed, link relevant issues, and include screenshots for UI work.

## Security & Configuration

Never commit `.env` files, API keys, logs, or conversation data. Changes to file tools must follow `docs/文件操作安全规范.md`: validate resolved paths, protect system and `.git` directories, and require confirmation before destructive or write operations.
