function gbclone -d "clone a repo into a bare .git dir with a default-branch worktree"
  if test (count $argv) -lt 1; or test (count $argv) -gt 2
    echo "usage: gbclone <repo-url> [target-directory]" >&2
    return 1
  end

  set -l repo_url $argv[1]
  set -l repo_name
  if test (count $argv) -eq 2
    set repo_name $argv[2]
  else
    set repo_name (string replace -r '/$' '' -- $repo_url)
    set repo_name (string split -r -m1 / -- $repo_name)[-1]
    set repo_name (string split -r -m1 : -- $repo_name)[-1]
    set repo_name (string replace -r '\.git$' '' -- $repo_name)
  end

  if test -e "$repo_name"
    echo "gbclone: target already exists; skipping: $repo_name" >&2
    return 0
  end

  set -l clone_options --bare
  if command git clone -h 2>&1 | string match -q '*ref-format*'
    set --append clone_options --ref-format=reftable
  end

  command git clone $clone_options "$repo_url" "$repo_name/.git"; or begin
    command rm -rf -- "$repo_name"
    return 1
  end
  command git --git-dir="$repo_name/.git" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'; or begin
    command rm -rf -- "$repo_name"
    return 1
  end
  command git --git-dir="$repo_name/.git" fetch origin; or begin
    command rm -rf -- "$repo_name"
    return 1
  end

  set -l default_branch (path basename (command git --git-dir="$repo_name/.git" symbolic-ref HEAD)); or begin
    command rm -rf -- "$repo_name"
    return 1
  end
  command git --git-dir="$repo_name/.git" branch --set-upstream-to="origin/$default_branch" "$default_branch"; or begin
    command rm -rf -- "$repo_name"
    return 1
  end
  command git --git-dir="$repo_name/.git" worktree add "$repo_name/$default_branch" "$default_branch"; or begin
    command rm -rf -- "$repo_name"
    return 1
  end
end
