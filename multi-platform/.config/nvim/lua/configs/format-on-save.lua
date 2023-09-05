return function()
    local format_on_save = require("format-on-save")
    local formatters = require("format-on-save.formatters")

    format_on_save.setup({
        exclude_path_patterns = {
            "/node_modules/",
            ".local/share/nvim/lazy",
        },
        formatter_by_ft = {},
        -- Optional: fallback formatter to use when no formatters match the current filetype
        fallback_formatter = {
            formatters.lsp,
        },
        -- By default, all shell commands are prefixed with "sh -c" (see PR #3)
        -- To prevent that set `run_with_sh` to `false`.
        run_with_sh = false,
    })
end
