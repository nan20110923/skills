# skills

Personal agent skills, written in English and installable with the
[`skills`](https://github.com/vercel-labs/skills) CLI.

> **Status:** no skills published yet. This repository currently contains the
> layout, authoring rules, and validation that every new skill must follow.

## Install

Once skills are published, install them with:

```bash
# Every skill, every agent the CLI detects
npx skills add nan20110923/skills -a '*'

# One agent
npx skills add nan20110923/skills -a opencode
npx skills add nan20110923/skills -a claude-code

# A single skill
npx skills add nan20110923/skills --skill <skill-name> -a opencode

# See what the repository contains without installing
npx skills add nan20110923/skills --list
```

Skills install into the current project by default. Add `-g` for a global
install, and `--copy` if symlinks are not supported on your machine. See the
[CLI reference](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)
for all options.

## Layout

```text
skills/
  <category>/<skill-name>/SKILL.md
  <category>/<subcategory>/<skill-name>/SKILL.md   # at most two category levels
templates/SKILL.md.template
scripts/validate.mjs
```

Categories exist to make skills easy to find, so they are created when the first
skill in them lands. Suggested categories: `engineering/`, `design/`,
`writing/`, `ops/`.

## Adding a skill

1. Copy `templates/SKILL.md.template` to
   `skills/<category>/<skill-name>/SKILL.md`.
2. Fill in the frontmatter. `name` must match the directory name.
3. Write the body: what the skill produces, when to use it, and the exact steps.
4. Put long references and scripts next to `SKILL.md`, not inside it.
5. Run `npm run validate`.
6. Commit and push.

The full authoring rules live in [`AGENTS.md`](AGENTS.md).

## Validation

```bash
npm run validate
```

The validator has no dependencies and requires Node.js 22 or later. It checks
frontmatter, naming, directory depth, referenced files, and accidental secrets.
CI runs the same command and smoke-tests skill discovery once at least one skill
exists.

## License

[MIT](LICENSE)
