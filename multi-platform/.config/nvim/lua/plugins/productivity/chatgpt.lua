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
        yank_register = '"',
        popup_input = {
          submit = "<C-s>",
        },
        openai_params = {
          model = "gpt-4-turbo-preview",
          max_tokens = 500,
        },
      })

      require("which-key").register({
        ["<leader>c"] = {
          name = "ChatGPT",
          c = {
            ":ChatGPT<CR>",
            "Toggle (ChatGPT)",
          },
          s = {
            ":ChatGPTActAs<CR>",
            "ActAs (ChatGPT)",
          },
          e = {
            ":ChatGPTEditWithInstructions<CR>",
            "Edit (ChatGPT)",
            mode = { "n", "v" },
          },
          a = {
            name = "Actions (ChatGPT)",
            c = {
              ":ChatGPTRun complete_code<CR>",
              "Complete code",
              mode = { "n", "v" },
            },
            d = {
              ":ChatGPTRun docstring<CR>",
              "Docstring for func",
              mode = { "n", "v" },
            },
            t = {
              ":ChatGPTRun add_tests<CR>",
              "Add tests",
              mode = { "n", "v" },
            },
            b = {
              ":ChatGPTRun fix_bugs<CR>",
              "Fix bugs",
              mode = { "n", "v" },
            },
          },
        },
      })
    end,
  },
}
