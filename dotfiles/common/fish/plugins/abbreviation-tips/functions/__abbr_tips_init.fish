function __abbr_tips_init -d "Initialize abbreviations variables for fish-abbr-tips"
    # These lists are rebuilt for every shell, so keep them process-local. Appending
    # to universal variables persisted and broadcast every entry individually.
    set -eU __ABBR_TIPS_KEYS __ABBR_TIPS_VALUES
    set -l keys
    set -l values

    for definition in (string replace -r '.*-- ' '' -- (abbr --show))
        set -l fields (string split -m1 -- ' ' "$definition")
        set -a keys "$fields[1]"
        set -a values (string trim -c '\'' -- "$fields[2]")
    end

    set -gu __ABBR_TIPS_KEYS $keys
    set -gu __ABBR_TIPS_VALUES $values
end
