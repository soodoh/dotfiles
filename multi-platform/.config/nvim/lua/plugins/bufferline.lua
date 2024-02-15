return {
  -- Better buffer tab line
  {
    "akinsho/bufferline.nvim",
    version = "*",
    dependencies = "nvim-tree/nvim-web-devicons",
    config = function()
      require("bufferline").setup({
        options = {
          numbers = "buffer_id",
          diagnostics = "nvim_lsp",
        },
      })

      vim.keymap.set(
        "n",
        "<leader>bp",
        ":BufferLinePick<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<leader>bo",
        ":BufferLineCloseOthers<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<leader>J",
        ":BufferLineMovePrev<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<leader>K",
        ":BufferLineMoveNext<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<leader>j",
        ":BufferLineCyclePrev<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<leader>k",
        ":BufferLineCycleNext<CR>",
        { silent = true }
      )
    end,
  },
}
