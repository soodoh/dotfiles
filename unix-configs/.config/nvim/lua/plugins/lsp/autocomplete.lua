return {
  -- Autocomplete
  {
    "saghen/blink.cmp",
    dependencies = {
      -- common snippets for multiple language
      "rafamadriz/friendly-snippets",
      -- community sources
      "Kaiser-Yang/blink-cmp-avante",
      "Kaiser-Yang/blink-cmp-git",
      "MahanRahmati/blink-nerdfont.nvim",
      "moyiz/blink-emoji.nvim",
      "giuxtaposition/blink-cmp-copilot",
    },
    version = "1.*",
    opts = {
      keymap = {
        preset = "default",
        ["<Tab>"] = { "insert_next", "fallback" },
        ["<S-Tab>"] = { "insert_prev", "fallback" },
        ["<C-n"] = { "snippet_forward", "fallback_to_mappings" },
        ["<C-p"] = { "snippet_backward", "fallback_to_mappings" },
        ["<CR>"] = { "select_and_accept", "fallback" },
      },
      appearance = {
        nerd_font_variant = "mono",
      },
      completion = {
        documentation = { auto_show = true },
        trigger = { prefetch_on_insert = true },
      },
      sources = {
        default = {
          "copilot",
          "git",
          "avante",
          "nerdfont",
          "emoji",
          "lsp",
          "path",
          "snippets",
          "buffer",
        },
        providers = {
          copilot = {
            name = "copilot",
            module = "blink-cmp-copilot",
            score_offset = 100,
            async = true,
          },
          -- minuet = {
          --   name = "minuet",
          --   module = "minuet.blink",
          --   async = true,
          --   timeout_ms = 3000,
          --   score_offset = 50, -- Gives minuet higher priority among suggestions
          -- },
          avante = {
            module = "blink-cmp-avante",
            name = "Avante",
            opts = {},
          },
          git = {
            module = "blink-cmp-git",
            name = "Git",
            enabled = function()
              return vim.bo.filetype == "gitcommit"
            end,
            opts = {},
          },
          nerdfont = {
            module = "blink-nerdfont",
            name = "Nerd Fonts",
            score_offset = 15,
            opts = { insert = true }, -- Insert nerdfont icon (default) or complete its name
          },
          emoji = {
            module = "blink-emoji",
            name = "Emoji",
            score_offset = 15, -- Tune by preference
            opts = {
              insert = true,
              trigger = function()
                return { ":" }
              end,
            },
          },
        },
      },
      fuzzy = { implementation = "prefer_rust_with_warning" },
    },
    opts_extend = { "sources.default" },
  },
  -- For provider agnostic LLM autocomplete
  -- {
  --   "milanglacier/minuet-ai.nvim",
  --   config = function()
  --     require("minute").setup({})
  --   end,
  --   dependencies = {
  --     "nvim-lua/plenary.nvim",
  --     "saghen/blink.cmp",
  --   },
  -- },
}
