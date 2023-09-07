local get_setup = require("configs.lsp.default-setup")
local json_opts = get_setup()

json_opts.settings = {
    json = {
        -- Schemas https://www.schemastore.org
        schemas = {
            {
                fileMatch = { "package.json" },
                url = "https://json.schemastore.org/package.json",
            },
            {
                fileMatch = { "tsconfig*.json" },
                url = "https://json.schemastore.org/tsconfig.json",
            },
            {
                fileMatch = {
                    ".prettierrc",
                    ".prettierrc.json",
                    "prettier.config.json",
                },
                url = "https://json.schemastore.org/prettierrc.json",
            },
            {
                fileMatch = { ".eslintrc", ".eslintrc.json" },
                url = "https://json.schemastore.org/eslintrc.json",
            },
            {
                fileMatch = {
                    ".babelrc",
                    ".babelrc.json",
                    "babel.config.json",
                },
                url = "https://json.schemastore.org/babelrc.json",
            },
            {
                fileMatch = { "lerna.json" },
                url = "https://json.schemastore.org/lerna.json",
            },
            {
                fileMatch = { "now.json", "vercel.json" },
                url = "https://json.schemastore.org/now.json",
            },
            {
                fileMatch = {
                    ".stylelintrc",
                    ".stylelintrc.json",
                    "stylelint.config.json",
                },
                url = "http://json.schemastore.org/stylelintrc.json",
            },
        },
    },
}

return json_opts
