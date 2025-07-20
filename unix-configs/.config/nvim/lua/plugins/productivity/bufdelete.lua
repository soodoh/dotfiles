return {
  -- Keep windows open when closing buffer
  {
    "famiu/bufdelete.nvim",
    config = function()
      require("which-key").add({
        { "<leader>d", group = "BufDelete" },
        {
          "<leader>dd",
          ":Bdelete<CR>",
          desc = "Close buffer (keep window open)",
        },
        {
          "<leader>dw",
          ":bd<CR>",
          desc = "Close buffer & window",
        },
      })
    end,
  },
}
