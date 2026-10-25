# Two people, two Claudes, one game

Two people build this game, each with Claude Code on their own computer: William (GitHub `realworldbuilder`, owns the repo) and his friend. Neither is a git expert, so you do the git for them and tell them in one plain sentence what happened. The rules below are how the two copies stay one game. They apply to every session on either machine.

**`main` on GitHub is the game.** It is what the live site deploys (a push to `main` runs `.github/workflows/deploy.yml`), and it is the only version that counts. Anyone's local copy is just a draft until it is merged there.

## The loop, every task

1. **Start from the latest `main`.** `git fetch origin`, then branch off `origin/main`, never off a local `main` that may be days old: `git switch -c <topic> origin/main`. In a worktree that already has a branch, `git rebase origin/main` before the first edit. After fetching, run `git submodule update --init` and, if `package.json` or `pnpm-lock.yaml` changed, `pnpm install`.
2. **Say what the other person has been doing.** At the start of a session, look at `git log --oneline HEAD..origin/main`, `gh pr list` and `gh issue list`, and tell your person in a line or two what landed since they last worked and what is open. If an open PR or an assigned issue covers the same screen, feature or files as the task you were given, say so before you start, so the two of you do not build the same thing twice.
3. **Never commit to `main` or push to it.** Work on the branch, commit in the house style (one descriptive sentence per change, like the history in `git log`), push the branch, and open a pull request with `gh pr create`. The description says what changed, how to try it, and has a screenshot for anything visible (they live in `docs/`, as the rest do). The `Check` workflow runs the tests and the build on every PR; it has to be green.
4. **Merge only when your person says so**, with `gh pr merge <n> --merge --delete-branch`. A PR from the other person is merged by the other person, unless they wrote on the PR that it can go in.
5. **Keep it short.** A PR should be merged within a day or two. A branch that lives for a week is how the two versions drift apart. If a branch has to live longer, bring `main` into it every day: `git fetch origin && git merge origin/main`, then test.

## When the two of you collide

- **A merge conflict** means both people changed the same lines. Resolve it, run `pnpm test && pnpm build`, and tell your person in plain words what the two sides were and which you kept. If the conflicting code is the other person's and the right answer is not obvious, do not guess: leave it unmerged, write the question as a comment on the PR (`gh pr comment`), and tell your person to ask their friend.
- **Talking to the other Claude**: PR descriptions, PR comments and issues are the shared channel; both sessions can read them with `gh pr view <n> --comments` and `gh issue view <n> --comments`. Write them so the other person's Claude can act on them without this conversation: what, where (file paths), why.
- **Reviewing the other person's PR** when asked: `gh pr checkout <n>` to run it, `gh pr diff <n>` to read it, then `gh pr review <n> --comment -b "..."` (or `--approve`). Switch back to your own branch afterwards.

## Ideas and who is on what

Ideas and to-dos go in GitHub issues, one per idea (`gh issue create`), not in chat or in a local file only one machine has. Whoever starts one assigns it to themselves (`gh issue edit <n> --add-assignee @me`) so the other side sees it is taken; the PR that does it says `Closes #<n>`.

## What does not go in this file

Each person's own machine (where their World of Warcraft install is, their computers, their accounts) belongs in their own `~/.claude/CLAUDE.md`, not here. This file is shared; keep it about the game and how the two of you work on it.
