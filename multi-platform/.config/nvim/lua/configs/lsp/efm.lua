local get_setup = require("configs.lsp.default-setup")
local efm_opts = get_setup()

local javascript = {
    require("efmls-configs.linters.eslint_d"),
    require("efmls-configs.formatters.eslint_d"),
    require("efmls-configs.formatters.prettier_d"),
}

efm_opts.init_options = { documentFormatting = true }
efm_opts.settings = {
    rootMarkers = { ".git/" },
    languages = {
        lua = {
            require("efmls-configs.linters.luacheck"),
            require("efmls-configs.formatters.stylua"),
        },
        typescript = javascript,
        javascript = javascript,
        typescriptreact = javascript,
        javascriptreact = javascript,
    },
}

return efm_opts
