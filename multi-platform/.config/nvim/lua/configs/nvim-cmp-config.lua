return function()
    local cmp = require("cmp")
    local lspkind = require("lspkind")

    cmp.setup({
        snippet = {
            -- REQUIRED - you must specify a snippet engine
            expand = function(args)
                vim.fn["vsnip#anonymous"](args.body) -- For `vsnip` users.
            end,
        },
        mapping = {
            ["<C-n>"] = cmp.mapping.select_next_item({
                behavior = cmp.SelectBehavior.Insert,
            }),
            ["<C-p>"] = cmp.mapping.select_prev_item({
                behavior = cmp.SelectBehavior.Insert,
            }),
            ["<Down>"] = cmp.mapping.select_next_item({
                behavior = cmp.SelectBehavior.Select,
            }),
            ["<Up>"] = cmp.mapping.select_prev_item({
                behavior = cmp.SelectBehavior.Select,
            }),
            ["<C-b>"] = cmp.mapping.scroll_docs(-4),
            ["<C-f>"] = cmp.mapping.scroll_docs(4),
            ["<C-Space>"] = cmp.mapping.complete(),
            ["<C-e>"] = cmp.mapping.close(),
            ["<CR>"] = cmp.mapping.confirm({
                behavior = cmp.ConfirmBehavior.Replace,
                select = true,
            }),
        },
        sources = cmp.config.sources({
            { name = "nvim_lsp" },
            { name = "vsnip" },
        }, {
            { name = "nvim_lua" },
            { name = "copilot" },
            { name = "path" },
        }),
        formatting = {
            format = lspkind.cmp_format({
                mode = "symbol_text",
                maxwidth = 50,
                ellipsis_char = "...",
                menu = {
                    buffer = "Buffer",
                    vsnip = "Snip",
                    nvim_lua = "Lua",
                    path = "Path",
                    copilot = "Copilot",
                    nvim_lsp = "LSP",
                },
            }),
        },
    })

    -- Use buffer source for `/` (if you enabled `native_menu`, this won't work anymore).
    cmp.setup.cmdline("/", {
        mapping = cmp.mapping.preset.cmdline(),
        sources = {
            { name = "buffer" },
        },
    })

    -- Use cmdline & path source for ':' (if you enabled `native_menu`, this won't work anymore).
    cmp.setup.cmdline(":", {
        mapping = cmp.mapping.preset.cmdline(),
        sources = cmp.config.sources({
            { name = "path" },
        }, {
            {
                name = "cmdline",
                option = {
                    ignore_cmds = { "Man", "!" },
                },
            },
        }),
        formatting = {
            format = lspkind.cmp_format({
                mode = "symbol",
            }),
        },
    })
end
