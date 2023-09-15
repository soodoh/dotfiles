local get_setup = require("configs.lsp.default-setup")
local efm_opts = get_setup()

local javascript = {
    require("efmls-configs.linters.eslint_d"),
    require("efmls-configs.formatters.eslint_d"),
    require("efmls-configs.formatters.prettier_d"),
}

local languages = {
    lua = {
        require("efmls-configs.formatters.stylua"),
    },
    javascript = javascript,
    javascriptreact = javascript,
    typescript = javascript,
    typescriptreact = javascript,
    css = {
        require("efmls-configs.formatters.prettier_d"),
    },
    graphql = {
        require("efmls-configs.formatters.prettier_d"),
    },
    html = {
        require("efmls-configs.formatters.prettier_d"),
    },
    markdown = {
        require("efmls-configs.formatters.prettier_d"),
    },
    json = {
        require("efmls-configs.formatters.prettier_d"),
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
