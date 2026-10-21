# skills/

Every skill lives in this directory as `<category>/<skill-name>/SKILL.md`.

- Categories group related skills and are created when the first skill in them
  lands. Suggested: `engineering/`, `design/`, `writing/`, `ops/`.
- At most two category levels: `skills/<category>/<subcategory>/<skill>/SKILL.md`.
- The directory name must equal the `name` field in `SKILL.md`.
- Supporting files (`references/`, `scripts/`, `assets/`) belong inside the
  skill directory so they are installed with it.

This README is not a skill and is ignored by the CLI.

See [`AGENTS.md`](../AGENTS.md) for the authoring rules and
[`templates/SKILL.md.template`](../templates/SKILL.md.template) for the starter
file.
