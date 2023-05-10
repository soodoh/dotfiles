return function()
    vim.keymap.set("n", "gr", ":Lspsaga rename<CR>", { silent = true })
    -- vim.keymap.set('n', 'k', ":Lspsaga hover_doc<CR>", {silent=true})
    vim.keymap.set(
        "n",
        "<leader>ca",
        ":Lspsaga code_action<CR>",
        { silent = true }
    )
    vim.keymap.set(
        "v",
        "<leader>ca",
        ":Lspsaga code_action<CR>",
        { silent = true }
    )

    -- only show diagnostic if cursor is over the area
    vim.keymap.set(
        "n",
        "<leader>cc",
        ":Lspsaga show_cursor_diagnostics<CR>",
        { silent = true }
    )
    vim.keymap.set(
        "n",
        "<leader>cd",
        ":Lspsaga show_line_diagnostics<CR>",
        { silent = true }
    )
    vim.keymap.set(
        "n",
        "[e",
        ":Lspsaga diagnostic_jump_prev<CR>",
        { silent = true }
    )
    vim.keymap.set(
        "n",
        "]e",
        ":Lspsaga diagnostic_jump_next<CR>",
        { silent = true }
    )

    require("lspsaga").setup({
        code_action = {
            extend_gitsigns = false,
        },
        lightbulb = {
            virtual_text = false,
        },
    })
end
