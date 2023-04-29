return function()
    require("chatgpt").setup({
        yank_register = "*",
        popup_input = {
            submit = "<C-s>",
        },
        -- chat = {
        --     keymaps = {
        --         yank_last_code = "<C-y>",
        --     },
        -- },
    })

    vim.keymap.set("n", "<leader>fc", ":ChatGPT<CR>", {silent=true})
    vim.keymap.set("n", "<leader>fe", ":ChatGPTEditWithInstructions<CR>", {silent=true})
    vim.keymap.set("n", "<leader>fr", ":ChatGPTRun ")
end
