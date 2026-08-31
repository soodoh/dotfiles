function __fish_git_auto_fetch --on-variable PWD --description 'Auto git fetch on directory change'
    if not command -q git
        return
    end

    if set -q __fish_git_auto_fetch_pid
        if command kill -0 $__fish_git_auto_fetch_pid 2>/dev/null
            return
        end
        set -e __fish_git_auto_fetch_pid
    end

    if not command git rev-parse --is-inside-work-tree &>/dev/null
        return
    end

    set -l remotes (command git remote 2>/dev/null)
    if not set -q remotes[1]
        return
    end

    set -l fetch_head (command git rev-parse --git-path FETCH_HEAD 2>/dev/null)
    if test -z "$fetch_head"
        return
    end

    # Fetch at most once every five minutes per repository.
    if test -f "$fetch_head"
        set -l now (date +%s)
        set -l fetch_time (stat -f %m "$fetch_head" 2>/dev/null; or stat -c %Y "$fetch_head" 2>/dev/null)
        if test -n "$fetch_time"
            set -l age (math "$now - $fetch_time")
            if test "$age" -lt 300
                return
            end
        end
    end

    set -lx GIT_TERMINAL_PROMPT 0
    command git fetch --quiet &>/dev/null &
    set -g __fish_git_auto_fetch_pid $last_pid
    disown
end
