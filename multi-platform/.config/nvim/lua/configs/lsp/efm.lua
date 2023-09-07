local get_setup = require("configs.lsp.default-setup")
local efm_opts = get_setup()

local languages = {
    lua = {
        require("efmls-configs.formatters.stylua"),
    },
    css = {
        require("efmls-configs.formatters.prettier"),
    },
    graphql = {
        require("efmls-configs.formatters.prettier"),
    },
    html = {
        require("efmls-configs.formatters.prettier"),
    },
    markdown = {
        require("efmls-configs.formatters.prettier"),
    },
    json = {
        require("efmls-configs.formatters.prettier"),
    },
    python = {
        require("efmls-configs.formatters.black"),
    },
}

efm_opts.filetypes = vim.tbl_keys(languages)
efm_opts.init_options = {
    documentFormatting = true,
    documentRangeFormatting = true,
}
efm_opts.settings = {
    rootMarkers = { ".git/" },
    languages = languages,
}

return efm_opts
