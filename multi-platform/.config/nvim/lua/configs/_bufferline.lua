return function()
    require("bufferline").setup({
        options = {
            numbers = "buffer_id",
            diagnostics = "nvim_lsp",
        },
    })

    local keymap = require("utils").keymap
    keymap("n", "<leader>b", ":BufferLinePick<CR>")
    keymap("n", "<leader>k", ":BufferLineMovePrev<CR>")
    keymap("n", "<leader>l", ":BufferLineMoveNext<CR>")
    keymap("n", "<leader>j", ":BufferLineCyclePrev<CR>")
    keymap("n", "<leader>'", ":BufferLineCycleNext<CR>")
end
