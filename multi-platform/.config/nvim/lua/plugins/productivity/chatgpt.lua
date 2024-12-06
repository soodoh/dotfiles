return {
  -- Copilot
  {
    "zbirenbaum/copilot.lua",
    cmd = "Copilot",
    event = "InsertEnter",
    config = function()
      require("copilot").setup({
        panel = {
          enabled = false,
        },
        suggestion = {
          enabled = false,
        },
        filetypes = {
          yaml = true,
          lua = true,
          javascript = true,
          typescript = true,
          javascriptreact = true,
          typescriptreact = true,
        },
      })
    end,
  },
  {
    "zbirenbaum/copilot-cmp",
    config = function()
      require("copilot_cmp").setup({})
    end,
  },
  {
    "CopilotC-Nvim/CopilotChat.nvim",
    branch = "main",
    dependencies = {
      "zbirenbaum/copilot.lua",
      "nvim-lua/plenary.nvim",
    },
    build = "make tiktoken",
    config = function()
      require("CopilotChat").setup({})
      require("which-key").add({
        {
          "<leader>cc",
          ":CopilotChatToggle<CR>",
          desc = "Toggle (Copilot)",
        },
      })
    end,
  },
  -- ChatGPT
  {
    "jackMort/ChatGPT.nvim",
    event = "VeryLazy",
    dependencies = {
      "MunifTanjim/nui.nvim",
      "nvim-lua/plenary.nvim",
      "folke/trouble.nvim",
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

      require("which-key").add({
        { "<leader>c", group = "ChatGPT/Copilot" },
        {
          "<leader>cg",
          ":ChatGPT<CR>",
          desc = "Toggle (ChatGPT)",
        },
        {
          "<leader>cge",
          ":ChatGPTEditWithInstructions<CR>",
          desc = "Edit (ChatGPT)",
          mode = { "n", "v" },
        },
      })
    end,
  },
}
