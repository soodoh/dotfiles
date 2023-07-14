return function()
    require("toggleterm").setup({
        open_mapping = "<C-Space>",
        insert_mappings = false,
        terminal_mappings = true,
        size = vim.o.columns * 0.4,
        direction = "vertical",
    })
    local Terminal = require("toggleterm.terminal").Terminal
    local lazygit = Terminal:new({
        cmd = "lazygit",
        direction = "float",
        hidden = true,
    })
    local lf =
        Terminal:new({ cmd = "lf", direction = "float", hidden = true })

    function lazygit_toggle()
        lazygit:toggle()
    end

    function lf_toggle()
        lf:toggle()
    end

    -- Lazygit
    vim.keymap.set(
        "n",
        "<leader>gg",
        "<cmd>lua lazygit_toggle()<CR>",
        { noremap = true, silent = true }
    )

    -- LF file manager
    vim.keymap.set(
        "n",
        "<leader>e",
        "<cmd>lua lf_toggle()<CR>",
        { silent = true }
    )
end
