return function()
    -- require("hop").setup({ keys = "etovxqpdygfblzhckisuran" })
    vim.keymap.set("n", "s", "<cmd>HopChar2<CR>")
    vim.keymap.set("n", "gl", "<cmd>HopLineStart<CR>")
end
