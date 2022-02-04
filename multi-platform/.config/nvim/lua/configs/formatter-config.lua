return function()
    local eslint = function()
        local filename = vim.fn.shellescape(vim.api.nvim_buf_get_name(0))
        return {
            exe = "npx eslint",
            args = { "--stdin-filename", filename, "--fix" },
            stdin = false,
        }
    end
    local prettier = function()
        local filename = vim.fn.shellescape(vim.api.nvim_buf_get_name(0))
        return {
            exe = "npx prettier",
            args = { "--stdin-filepath", filename },
            stdin = true,
        }
    end
    local stylua = function()
        local filename = vim.fn.shellescape(vim.api.nvim_buf_get_name(0))
        return {
            exe = "stylua",
            args = {
                "--search-parent-directories",
                filename,
            },
            stdin = false,
        }
    end

    require("formatter").setup({
        filetype = {
            javascript = { eslint, prettier },
            javascriptreact = { eslint, prettier },
            typescript = { eslint, prettier },
            typescriptreact = { eslint, prettier },
            css = { prettier },
            scss = { prettier },
            html = { prettier },
            markdown = { prettier },
            json = { prettier },
            jsonc = { prettier },
            lua = { stylua },
        },
    })

    local keymap = require("utils").keymap
    keymap("n", "<leader>f", ":Format<cr>")
    -- Format on save
    vim.api.nvim_exec(
        [[
augroup FormatAutogroup
  autocmd!
  autocmd BufWritePost *.js,*.ts,*.jsx,*.tsx,*.css,*.scss,*.html,*.md,*.json,*.jsonc,*.lua FormatWrite
augroup END
]],
        true
    )
end
