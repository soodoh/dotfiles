return function ()
    local eslint = function()
        return {
            exe = 'npx eslint',
            args = {"--stdin-filename", vim.api.nvim_buf_get_name(0), "--fix", "--cache"},
            stdin = false
        }
    end
    local prettier = function()
        return {
            exe = "npx prettier",
            args = {"--stdin-filepath", vim.fn.fnameescape(vim.api.nvim_buf_get_name(0)), '--single-quote'},
            stdin = true
        }
    end

    require('formatter').setup({
        filetype = {
            javascript = { eslint, prettier },
            javascriptreact = { eslint, prettier },
            typescript = { eslint, prettier },
            typescriptreact = { eslint, prettier },
            lua = {
                function()
                    return {
                        exe = "stylua",
                        args = {
                            "--config-path "
                                .. os.getenv("XDG_CONFIG_HOME")
                                .. "/stylua/stylua.toml",
                            "-",
                        },
                        stdin = true,
                    }
                end,
            },
        }
    })
end
