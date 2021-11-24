return function()
    local filename = vim.fn.fnameescape(vim.api.nvim_buf_get_name(0))
    local eslint = function()
        return {
            exe = "npx eslint",
            args = { "--stdin-filename", filename, "--fix", "--cache" },
            stdin = false,
        }
    end
    local prettier = function()
        return {
            exe = "npx prettier",
            args = { "--stdin-filepath", filename },
            stdin = true,
        }
    end

    require("formatter").setup({
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
                            "--search-parent-directories",
                            filename,
                        },
                        stdin = false,
                    }
                end,
            },
        },
    })

    local keymap = require("utils").keymap
    keymap("n", "<leader>f", ":Format<cr>")
    -- Format on save
    vim.api.nvim_exec(
        [[
augroup FormatAutogroup
  autocmd!
  autocmd BufWritePost *.js,*.ts,*.jsx,*.tsx,*.lua FormatWrite
augroup END
]],
        true
    )
end
