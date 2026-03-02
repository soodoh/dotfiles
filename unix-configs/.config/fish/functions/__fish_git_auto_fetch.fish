function __fish_git_auto_fetch --on-variable PWD --description 'Auto git fetch on directory change'
    if not command -q git
        return
    end

    if not git rev-parse --is-inside-work-tree &>/dev/null
        return
    end

    # Only fetch if last fetch was more than 60 seconds ago
    set -l git_dir (git rev-parse --git-dir 2>/dev/null)
    if test -z "$git_dir"
        return
    end

    set -l fetch_head "$git_dir/FETCH_HEAD"
    if test -f $fetch_head
        # Check if FETCH_HEAD is older than 60 seconds
        set -l now (date +%s)
        set -l fetch_time (stat -f %m $fetch_head 2>/dev/null; or stat -c %Y $fetch_head 2>/dev/null)
        if test -n "$fetch_time"
            set -l age (math $now - $fetch_time)
            if test $age -lt 60
                return
            end
        end
    end

    # Fetch in background
    command git fetch --quiet &
    disown
end
