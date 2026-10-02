# Multi-agent merges

When several subagents implement tickets that merge into one integration branch, merges are **serial**: one merger owns the integration branch from its first `git checkout` until its push lands. The dispatcher starts the next merger only after the previous one reports its push accepted.

The serial merger works in a dedicated worktree (not the main checkout), so its in-progress merge is invisible to every other agent.

## Merger steps

0. Set up the worktree: `npm ci` at the repo root — every worktree needs it, since a worktree shares no untracked files and the root suite itself lives in devDependencies; tickets touching `worker/` also run `npm ci` in `worker/`. Done when `npx wrangler --version` prints a version.
1. Claim the branch: `git fetch origin && git checkout <integration-branch>` in your own worktree. Done when the working tree is clean and local HEAD equals origin.
2. Merge one ticket branch with `git merge --no-ff`, resolve conflicts against the ticket's intent. Done when no unmerged paths remain and no stray edits sit outside the conflict set.
3. Verify: typecheck + full test suites, per this repo's scripts. Done when all green (a pre-existing flaky test is re-run in isolation, never chased). If a failure looks timing-dependent, investigate it as a real regression first — the previously known flake in `src/cloud/__tests__/sync-multidevice.test.ts`「共享目录仅修改附加要求和移除要求都能往返」was root-caused and fixed in #268 and is no longer exempt.
4. Push. Done when the push is accepted. Report the merge commit, conflicts resolved, and test results.

If the push is rejected, another merger was started by mistake: stop and report instead of replaying.

## Dispatcher rule

At most one merger is in flight per integration branch. Sequence mergers by dependency order; run implementers in parallel freely — they own separate worktrees, follow the same setup step (step 0), and never touch the integration branch.

The dispatcher never holds the integration branch checked out: a branch can be checked out in only one worktree at a time, and a dispatcher holding it blocks every merger's step 1. Bootstrap the branch without a local checkout (`git push origin main:refs/heads/<integration>`); if the bootstrap empty commit needs a checkout, use a short-lived one and switch back to `main` as soon as the draft PR exists. From then on the integration branch lives only in merger worktrees — the dispatcher watches progress through read-only `origin/*` refs (`git fetch origin && git log/diff origin/<integration>`) and `gh pr view`, which need no checkout.

## Integration PR

`gh pr create` rejects a branch that sits at the same commit as its base ("No commits between…"). Bootstrap the PR first: push the integration branch, add one empty commit on it (`git commit --allow-empty`), push again, then open the draft PR whose body closes the spec and every ticket in the graph. Done when the draft PR exists and its closing body lists the whole ticket graph.

Subagents report their temp worktree paths in their hand-off. The dispatcher removes each worktree (`git worktree remove`) once its branch is merged, and deletes local ticket branches after the PR merges. Done when `git worktree list` shows only the dispatcher's own checkout.

## Why serial

The integration branch is a single linear history, so parallel mergers only fake parallelism: the push serializes them anyway, while a shared checkout adds uncommitted-file clobbering and half-done merges on top. Merges cost minutes; the real parallelism is in the implementers.
