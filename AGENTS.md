# Authoring skills in this repository

This file is the contract for every skill in `skills/`. Read it before adding or
editing one.

## Principles

- **One skill, one job.** If the description needs "and" twice, split the skill.
- **English only.** Frontmatter, body, scripts, and comments.
- **Portable.** No company-specific hostnames, usernames, repository URLs, or
  credentials. Skills here are public.
- **Original.** Do not vendor skills written by someone else. Link to the
  upstream source instead.
- **Short body, deep references.** Keep `SKILL.md` under roughly 200 lines and
  move details into files next to it.

## Layout

```text
skills/<category>/<skill-name>/SKILL.md
skills/<category>/<subcategory>/<skill-name>/SKILL.md
```

- A skill is a directory containing `SKILL.md`.
- Category depth is at most two levels. The CLI searches three levels below
  `skills/`, which is exactly `<category>/<subcategory>/<skill-name>/`.
- Supporting files go inside the skill directory: `references/`, `scripts/`,
  `assets/`. They travel with the skill when it is installed.
- Never place a file named `SKILL.md` anywhere outside `skills/`. The CLI falls
  back to a recursive search and would treat it as an installable skill. The
  template is `templates/SKILL.md.template` for this reason.
- Do not add a `README.md` to a skill directory. Instructions belong in
  `SKILL.md`.

## Frontmatter

Required:

```yaml
---
name: kebab-case-name
description: What the skill does. Use when the user asks for X, Y, or Z.
---
```

- `name`: lowercase letters, digits, and single hyphens. Must equal the skill
  directory name. Must be unique across the repository.
- `description`: one or two sentences, under 1024 characters, ideally under 500.
  Start with the outcome, then say when to use it. Include the concrete phrases
  a user would type, because the description is the only thing an agent sees
  before deciding to load the skill.

Good:

```yaml
description: Audit macOS disk usage and clean it up in safe tiers. Use when the user says the disk is full, asks what is taking up space, or wants to clear caches.
```

Bad:

```yaml
description: A helpful skill for disks.
```

Optional keys are allowed (`license`, `metadata`, `allowed-tools`), but never use
`metadata.internal` to hide sensitive content: it only hides a skill from
discovery, the file is still public.

## Body

A useful shape:

```markdown
# Skill title

What the skill produces, in one paragraph.

## When to use

Concrete situations, including phrases the user might say.

## Workflow

1. Ordered steps with commands where relevant.
2. Decision points and fallbacks.

## Pitfalls

Mistakes that are easy to make and how to avoid them.

## Resources

- `references/details.md` for the long version.
- `scripts/check.sh` for the executable part.
```

Rules:

- Prefer commands and file paths over prose.
- Every relative path mentioned in the body must exist in the skill directory.
- Use `https://`, never `http://`, `localhost`, or private network addresses.
- No secrets, tokens, private keys, or personal data.
- Do not duplicate the whole skill in a second language.

## Validate

```bash
npm run validate
```

The validator checks frontmatter, name/directory agreement, description length,
directory depth, referenced files, and common secret patterns. CI runs it on
every push and pull request.

## Commit

- One skill per commit where practical.
- Message: `feat(<skill-name>): add <skill-name>` or `fix(<skill-name>): ...`.
- Run `npm run validate` before committing.
