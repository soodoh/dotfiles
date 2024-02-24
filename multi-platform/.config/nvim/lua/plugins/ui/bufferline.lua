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
      require("which-key").register({
        ["<leader>"] = {
          b = {
            name = "Buffers",
            p = { ":BufferLinePick<CR>", "Go to (BufferLine)" },
            o = {
              "<C-w>o<CR>:BufferLineCloseOthers<CR>",
              "Close all (BufferLine)",
            },
          },
          j = {
            ":BufferLineCyclePrev<CR>",
            "Go left (BufferLine)",
          },
          k = {
            ":BufferLineCycleNext<CR>",
            "Go right (BufferLine)",
          },
          J = {
            ":BufferLineMovePrev<CR>",
            "Move left (BufferLine)",
          },
          K = {
            ":BufferLineMoveNext<CR>",
            "Move right (BufferLine)",
          },
        },
      })
    end,
  },
}
