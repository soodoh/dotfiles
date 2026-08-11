function gbclone -d "clone a repo into a bare .git dir with a default-branch worktree"
  if test (count $argv) -ne 1
    echo "usage: gbclone <repo-url>" >&2
    return 1
  end

  set -l repo_url $argv[1]
  set -l repo_name (string replace -r '/$' '' -- $repo_url)
  set repo_name (string split -r -m1 / -- $repo_name)[-1]
  set repo_name (string split -r -m1 : -- $repo_name)[-1]
  set repo_name (string replace -r '\.git$' '' -- $repo_name)

  if test -e "$repo_name"
    echo "gbclone: target already exists: $repo_name" >&2
    return 1
  end

  command git clone --bare "$repo_url" "$repo_name/.git"; or return

  set -l default_branch (path basename (command git --git-dir="$repo_name/.git" symbolic-ref HEAD)); or return
  command git --git-dir="$repo_name/.git" worktree add "$repo_name/$default_branch" "$default_branch"
end
