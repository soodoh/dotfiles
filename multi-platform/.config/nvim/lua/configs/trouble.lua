return function()
    vim.keymap.set("n", "<leader>xx", ":Trouble<CR>", { silent = true })
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
