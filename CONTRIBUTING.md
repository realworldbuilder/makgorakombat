# Working on the game together

The short version for the two of us. Claude does the git; this is what to say to it and what is going on underneath.

## Once, on a new computer

1. Accept the collaborator invite William sends (it comes by email from GitHub, or at https://github.com/realworldbuilder/makgorakombat/invitations).
2. Install the tools and log in to GitHub: `brew install gh pnpm`, then `gh auth login`.
3. Get the game: `git clone --recurse-submodules https://github.com/realworldbuilder/makgorakombat.git`, then `cd makgorakombat && pnpm install && pnpm dev`.
4. Open that folder in Claude Code. It reads `CLAUDE.md` on its own; that file is the rules both Claudes follow.

If you already have a copy with changes in it, tell Claude: *"I have local changes from before the invite. Get them onto a branch off the latest main and open a PR."*

## Every time

| You say | What Claude does |
|---|---|
| "What's new?" | Pulls the latest from GitHub and tells you what the other person merged and has open. |
| "Let's make the fatality camera shake harder." | Makes a branch off the latest `main`, does the work there. |
| "Looks good, put it up." | Commits, pushes the branch, opens a pull request (PR) with a screenshot. The other person gets a notification. |
| "Merge it." | Merges the PR into `main`. The live site updates in a minute or two. |
| "Review his PR" / "Try her PR" | Checks out the other person's PR so you can play it, reads the change, leaves a comment. |

## The three habits that stop us drifting apart

1. **Small and often.** One idea per PR, merged within a day or two. Big, week-long branches are what turns into a mess.
2. **Start from fresh `main`.** Claude does this on its own, but if a session has been open for days, say "update from main first".
3. **Ideas go in issues.** Got an idea? "Make an issue for it." Starting on one? "Assign it to me." Then we can both see who is doing what.

## Words

- **`main`**: the real game, what is on the live site.
- **branch**: your draft copy for one idea.
- **pull request (PR)**: "here is my draft, please put it in the game". The place to talk about it.
- **merge**: putting a PR's changes into `main`.
- **conflict**: we both changed the same lines. Claude sorts it out and asks if it is not sure whose version wins.
