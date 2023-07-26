return function()
    local trouble = require("trouble")
    -- Quickfix-like navigation
    vim.keymap.set("n", "<leader>,", function()
        trouble.previous({ skip_groups = true, jump = true })
    end, { silent = true })
    vim.keymap.set("n", "<leader>.", function()
        trouble.next({ skip_groups = true, jump = true })
    end, { silent = true })

    -- Toggle
    vim.keymap.set(
        "n",
        "<leader>xx",
        ":TroubleToggle<CR>",
        { silent = true }
    )

    -- Open specific items
    vim.keymap.set(
        "n",
        "<leader>xw",
        ":Trouble workspace_diagnostics<CR>",
        { silent = true }
    )
    vim.keymap.set(
        "n",
        "<leader>xd",
        ":Trouble document_diagnostics<CR>",
        { silent = true }
    )
    vim.keymap.set(
        "n",
        "<leader>xq",
        ":Trouble quickfix<CR>",
        { silent = true }
    )
    vim.keymap.set(
        "n",
        "<leader>xl",
        ":Trouble lsp_references<CR>",
        { silent = true }
    )
end
