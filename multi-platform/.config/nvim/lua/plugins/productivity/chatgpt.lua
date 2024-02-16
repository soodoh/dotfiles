return {
  -- ChatGPT integration
  {
    "jackMort/ChatGPT.nvim",
    event = "VeryLazy",
    dependencies = {
      "MunifTanjim/nui.nvim",
      "nvim-lua/plenary.nvim",
      "nvim-telescope/telescope.nvim",
    },
    config = function()
      local chatgpt = require("chatgpt")
      chatgpt.setup({
        yank_register = "*",
        popup_input = {
          submit = "<C-s>",
        },
        openai_params = {
          model = "gpt-4-turbo-preview",
          max_tokens = 500,
        },
      })

      vim.keymap.set(
        "n",
        "<leader>vv",
        ":ChatGPT<CR>",
        { silent = true }
      )
      vim.keymap.set(
        "n",
        "<leader>va",
        ":ChatGPTActAs<CR>",
        { silent = true }
      )
      vim.keymap.set(
        { "n", "v" },
        "<leader>ve",
        ":ChatGPTEditWithInstructions<CR>",
        { silent = true }
      )
      vim.keymap.set({ "n", "v" }, "<leader>vw", ":ChatGPTRun ")
    end,
  },
}
