return function()
    require("bufferline").setup({
        options = {
            numbers = "buffer_id",
            diagnostics = "nvim_lsp",
        },
    })

    local keymap = require("utils").keymap
    keymap("n", "<leader>b", ":BufferLinePick<CR>")
    keymap("n", "<leader>J", ":BufferLineMovePrev<CR>")
    keymap("n", "<leader>K", ":BufferLineMoveNext<CR>")
    keymap("n", "<leader>j", ":BufferLineCyclePrev<CR>")
    keymap("n", "<leader>k", ":BufferLineCycleNext<CR>")
end
