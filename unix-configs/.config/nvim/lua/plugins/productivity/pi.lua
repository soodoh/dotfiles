return {
  {
    "pablopunk/pi.nvim",
    config = function()
      require("which-key").add({
        {
          "<leader>ai",
          ":PiAsk<CR>",
          desc = "Ask pi",
          mode = { "n" },
        },
        {
          "<leader>ai",
          ":PiAskSelection<CR>",
          desc = "Ask pi (selection)",
          mode = { "v" },
        },
      })
    end,
  },
}
