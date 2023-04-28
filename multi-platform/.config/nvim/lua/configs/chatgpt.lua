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

    local keymap = require("utils").keymap
    keymap("n", "<leader>fc", ":ChatGPT<CR>")
    keymap("n", "<leader>fe", ":ChatGPTEditWithInstructions<CR>")
    keymap("n", "<leader>fr", ":ChatGPTRun ")
end
