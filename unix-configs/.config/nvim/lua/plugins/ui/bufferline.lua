return {
  -- Better buffer tab line
  {
    "akinsho/bufferline.nvim",
    version = "*",
    dependencies = "nvim-tree/nvim-web-devicons",
    after = "catppuccin",
    config = function()
      require("bufferline").setup({
        -- highlights = require("catppuccin.groups.integrations.bufferline").get(),
        options = {
          numbers = "buffer_id",
          diagnostics = "nvim_lsp",
        },
      })
      require("which-key").add({
        { "<leader>b", group = "Buffers" },
        {
          "<leader>bp",
          ":BufferLinePick<CR>",
          desc = "Go to (BufferLine)",
        },
        {
          "<leader>bo",
          ":BufferLineCloseOthers<CR>",
          desc = "Close all (BufferLine)",
        },
        {
          "<leader>j",
          ":BufferLineCyclePrev<CR>",
          desc = "Go left (BufferLine)",
        },
        {
          "<leader>k",
          ":BufferLineCycleNext<CR>",
          desc = "Go right (BufferLine)",
        },
        {
          "<leader>J",
          ":BufferLineMovePrev<CR>",
          desc = "Move left (BufferLine)",
        },
        {
          "<leader>K",
          ":BufferLineMoveNext<CR>",
          desc = "Move right (BufferLine)",
        },
      })
    end,
  },
}
