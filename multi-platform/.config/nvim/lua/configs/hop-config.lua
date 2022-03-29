return function()
    local keymap = require("utils").keymap
    -- require("hop").setup({ keys = "etovxqpdygfblzhckisuran" })
    require("hop").setup()
    keymap("n", "s", "<cmd>HopChar2<CR>", {})
    keymap("n", "gl", "<cmd>HopLineStart<CR>", {})
end
