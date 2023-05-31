return function()
    -- require("hop").setup({ keys = "etovxqpdygfblzhckisuran" })
    require("hop").setup()
    vim.keymap.set("n", "s", "<cmd>HopChar2<CR>")
    vim.keymap.set("n", "gl", "<cmd>HopLineStart<CR>")
end
