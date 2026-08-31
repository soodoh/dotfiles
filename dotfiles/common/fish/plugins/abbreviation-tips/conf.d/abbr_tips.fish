for mode in default insert
    bind --mode $mode " " __abbr_tips_bind_space
    bind --mode $mode \n __abbr_tips_bind_newline
    bind --mode $mode \r __abbr_tips_bind_newline
end

set -g __abbr_tips_used 0

# The original plugin only set these defaults during its install event. This
# vendored copy is sourced directly, so initialize missing values per shell.
if not set -q ABBR_TIPS_REGEXES
    set -g ABBR_TIPS_REGEXES \
        '(^(\w+\s+)+(-{1,2})\w+)(\s\S+)' \
        '(^(\s?(\w-?)+){3}).*' \
        '(^(\s?(\w-?)+){2}).*' \
        '(^(\s?(\w-?)+){1}).*'
end
if not set -q ABBR_TIPS_PROMPT
    set -g ABBR_TIPS_PROMPT "\n💡 \e[1m{{ .abbr }}\e[0m => {{ .cmd }}"
end

# Trim simple/double quotes from args
function trim_value
    echo "$argv" | string trim --left --right --chars '"\'' | string join ' '
end

function __abbr_tips_install --on-event abbr_tips_install
    # Regexes used to find abbreviation inside command
    # Only the first matching group will be tested as an abbr
    set -Ux ABBR_TIPS_REGEXES
    set -a ABBR_TIPS_REGEXES '(^(\w+\s+)+(-{1,2})\w+)(\s\S+)'
    set -a ABBR_TIPS_REGEXES '(^(\s?(\w-?)+){3}).*'
    set -a ABBR_TIPS_REGEXES '(^(\s?(\w-?)+){2}).*'
    set -a ABBR_TIPS_REGEXES '(^(\s?(\w-?)+){1}).*'

    set -Ux ABBR_TIPS_PROMPT "\n💡 \e[1m{{ .abbr }}\e[0m => {{ .cmd }}"
    set -gx ABBR_TIPS_AUTO_UPDATE background

    __abbr_tips_init
end

function __abbr_tips --on-event fish_postexec -d "Abbreviation reminder for the current command"
    set -l command (string split ' ' -- "$argv")
    set -l cmd (string replace -r -a '\\s+' ' ' -- "$argv" )

    # Update abbreviations lists when adding/removing abbreviations
    if test "$command[1]" = abbr
        # Parse args as abbr options
        argparse --name abbr --ignore-unknown a/add e/erase g/global U/universal -- $command

        if set -q _flag_a
            and not contains -- "$argv[2]" $__ABBR_TIPS_KEYS
            set -a __ABBR_TIPS_KEYS "$argv[2]"
            set -a __ABBR_TIPS_VALUES (trim_value "$argv[3..-1]")
        else if set -q _flag_e
            and set -l abb (contains -i -- "$argv[2]" $__ABBR_TIPS_KEYS)
            set -e __ABBR_TIPS_KEYS[$abb]
            set -e __ABBR_TIPS_VALUES[$abb]
        end
    end

    # Exit when the abbreviation was used, the command is already abbreviated,
    # the command does not exist, or the command is a function.
    if test $__abbr_tips_used = 1
        set -g __abbr_tips_used 0
        return
    else if abbr -q "$cmd"
        or not type -q "$command[1]"
        return
    else if test (type -t "$command[1]") = function
        return
    end

    set -l abb
    if not set abb (contains -i -- "$cmd" $__ABBR_TIPS_VALUES)
        for r in $ABBR_TIPS_REGEXES
            if set abb (contains -i -- (string replace -r -a -- "$r" '$1' "$cmd") $__ABBR_TIPS_VALUES)
                break
            end
        end
    end

    if test -n "$abb"
        echo -e (string replace -a '{{ .cmd }}' -- "$__ABBR_TIPS_VALUES[$abb]" \
                (string replace -a '{{ .abbr }}' -- "$__ABBR_TIPS_KEYS[$abb]" "$ABBR_TIPS_PROMPT"))
    end

    return
end

function __abbr_tips_update --on-event abbr_tips_update
    __abbr_tips_clean
    __abbr_tips_install
end

function __abbr_tips_uninstall --on-event abbr_tips_uninstall
    __abbr_tips_clean
    functions --erase __abbr_tips_init
end
